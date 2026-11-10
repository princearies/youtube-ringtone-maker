import fs from 'node:fs'
import fsp from 'node:fs/promises'

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

export function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(error.code)
    ? error.code
    : 'ENGINE_ERROR'
  sendJson(res, status, { error: { code, message: error?.message || 'Something went wrong.' } })
}

export async function readJsonBody(req, limit = 8 * 1024) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const err = new Error('Request body too large')
      err.code = 'BODY_TOO_LARGE'
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }

  if (size === 0) return {}

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const err = new Error('Body must be valid JSON')
    err.code = 'INVALID_JSON'
    err.status = 400
    throw err
  }
}

function contentDisposition(name, inline) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(String(name)).replace(/['()]/g, escape)
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Stream a file with HTTP Range support so the browser's <audio> can seek,
 * loop and scrub the preview without downloading the whole track first.
 */
export async function streamFile(req, res, { filePath, contentType, filename, inline = false }) {
  let stat
  try {
    stat = await fsp.stat(filePath)
  } catch {
    const err = new Error('That file has expired. Render it again.')
    err.code = 'FILE_GONE'
    err.status = 410
    throw err
  }

  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-transform, max-age=0',
    'x-content-type-options': 'nosniff',
  }
  if (filename) headers['content-disposition'] = contentDisposition(filename, inline)

  const rangeHeader = req.headers.range
  const match = typeof rangeHeader === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null

  if (!match) {
    headers['content-length'] = stat.size
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res)
    return
  }

  const startRaw = match[1]
  const endRaw = match[2]
  let start = startRaw === '' ? null : Number.parseInt(startRaw, 10)
  let end = endRaw === '' ? null : Number.parseInt(endRaw, 10)

  if (start === null && end === null) {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
    return res.end()
  }
  if (start === null) {
    // Suffix range: last N bytes
    start = Math.max(0, stat.size - end)
    end = stat.size - 1
  } else if (end === null || end >= stat.size) {
    end = stat.size - 1
  }

  if (start >= stat.size || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
    return res.end()
  }

  headers['content-range'] = `bytes ${start}-${end}/${stat.size}`
  headers['content-length'] = end - start + 1
  res.writeHead(206, headers)
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res)
}
