export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'

  console.error('[API Error]', message)

  res.status(statusCode).json({
    success: false,
    message,
  })
}
