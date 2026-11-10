/** One error type carries both the HTTP status and a stable machine code. */
export class AppError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}

export function jsonError(c, status, code, message, extraHeaders) {
  return c.json({ error: { code, message } }, status, extraHeaders)
}

export function onError(error, c) {
  if (error instanceof AppError) {
    const headers = error.status === 429 ? { 'retry-after': '60' } : undefined
    return jsonError(c, error.status, error.code, error.message, headers)
  }

  // Malformed JSON body from c.req.json() (we normally parse manually).
  if (error instanceof SyntaxError) {
    return jsonError(c, 400, 'INVALID_JSON', 'The request body must be JSON.')
  }

  console.error('unhandled', error?.message ?? error)
  return jsonError(c, 500, 'INTERNAL', 'Something went wrong.')
}
