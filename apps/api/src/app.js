import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readConfig } from './config.js'
import { Engine } from './engine.js'
import { onError } from './errors.js'
import { convert, download, dropSource, health, prepare, preview, status } from './routes.js'

/**
 * CORS: same-origin deploys need nothing, split deploys (Pages + Worker) set
 * ALLOWED_ORIGINS. "*" allows any origin; otherwise the exact origin is echoed.
 */
function allowedOrigin(origin, c) {
  const list = String(c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (list.includes('*')) return origin || '*'
  if (origin && list.includes(origin)) return origin
  return null
}

export function createApp() {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: allowedOrigin,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      exposeHeaders: [
        'Content-Disposition',
        'Content-Range',
        'Accept-Ranges',
        'Content-Length',
        'Retry-After',
      ],
      maxAge: 86400,
    }),
  )

  // Per-request config + engine client, available to every handler.
  app.use('/api/*', async (c, next) => {
    const config = readConfig(c.env)
    c.set('config', config)
    c.set('engine', new Engine(config))
    await next()
  })

  const mount = (factory) => (c) => factory(c.get('engine'), c.get('config'))(c)

  // ── Public contract ────────────────────────────────────────────────────────
  app.post('/api/convert', mount(convert))
  app.get('/api/status/:jobId', mount(status))
  app.get('/api/download/:jobId', mount(download))

  // ── Editor helpers (preview audio + waveform, then convert by sourceId) ────
  app.post('/api/prepare', mount(prepare))
  app.get('/api/preview/:sourceId', mount(preview))
  app.delete('/api/source/:sourceId', mount(dropSource))

  app.get('/api/health', mount(health))

  // ── Backwards-compatible aliases from the first API draft ──────────────────
  app.post('/api/render', mount(convert))
  app.get('/api/jobs/:jobId', mount(status))
  app.get('/api/files/:jobId', mount(download))
  app.get('/api/sources/:sourceId/audio', mount(preview))
  app.delete('/api/sources/:sourceId', mount(dropSource))

  app.get('/api', (c) =>
    c.json({
      name: 'ringcut-api',
      endpoints: [
        'POST   /api/convert        { url | sourceId, start, end, format }',
        'GET    /api/status/:jobId',
        'GET    /api/download/:jobId[?inline=1]',
        'POST   /api/prepare        { url }',
        'GET    /api/preview/:sourceId',
        'DELETE /api/source/:sourceId',
        'GET    /api/health',
      ],
    }),
  )

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }, 404))
  app.onError(onError)

  return app
}
