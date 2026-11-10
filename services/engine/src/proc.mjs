import { spawn } from 'node:child_process'

/**
 * Run a binary with an argv array (never a shell string) and bounded output.
 * Rejects with { code: 'PROCESS_FAILED' | 'TIMEOUT' | 'OUTPUT_LIMIT' | 'SPAWN_FAILED' }.
 *
 * `binary: true` keeps stdout as a Buffer (used for raw PCM peak decoding).
 */
export function run(bin, args, options = {}) {
  const {
    timeout = 60_000,
    maxBytes = 8 << 20,
    onStdout,
    onStderr,
    env,
    binary = false,
  } = options

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
      })
    } catch (err) {
      reject(Object.assign(err, { code: 'SPAWN_FAILED', bin }))
      return
    }

    const outChunks = []
    const errChunks = []
    let outBytes = 0
    let errBytes = 0
    let settled = false
    let abortReason = null

    const timer = setTimeout(() => {
      if (settled) return
      abortReason = 'TIMEOUT'
      child.kill('SIGKILL')
    }, timeout)
    timer.unref?.()

    const settle = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    child.stdout?.on('data', (chunk) => {
      outBytes += chunk.length
      if (outBytes > maxBytes) {
        abortReason = 'OUTPUT_LIMIT'
        child.kill('SIGKILL')
        return
      }
      outChunks.push(chunk)
      onStdout?.(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      errBytes += chunk.length
      if (errBytes <= 128_000) errChunks.push(chunk)
      onStderr?.(chunk.toString('utf8'))
    })

    child.on('error', (err) => {
      settle(reject, Object.assign(err, { code: 'SPAWN_FAILED', bin }))
    })

    child.on('close', (exitCode, signal) => {
      const rawOut = Buffer.concat(outChunks)
      const stdout = binary ? rawOut : rawOut.toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8')

      if (abortReason === 'TIMEOUT') {
        settle(reject, Object.assign(new Error(`${bin} exceeded its time budget`), {
          code: 'TIMEOUT', bin, stderr,
        }))
        return
      }
      if (abortReason === 'OUTPUT_LIMIT') {
        settle(reject, Object.assign(new Error(`${bin} produced too much output`), {
          code: 'OUTPUT_LIMIT', bin, stderr,
        }))
        return
      }
      if (exitCode !== 0) {
        settle(reject, Object.assign(new Error(`${bin} exited with code ${exitCode}${signal ? ` (${signal})` : ''}`), {
          code: 'PROCESS_FAILED', bin, exitCode, signal, stderr,
        }))
        return
      }
      settle(resolve, { stdout, stderr, exitCode })
    })
  })
}

/** Binary present and executable? */
export async function available(bin, args = ['-version'], timeout = 8_000) {
  try {
    await run(bin, args, { timeout, maxBytes: 1 << 20 })
    return true
  } catch {
    return false
  }
}
