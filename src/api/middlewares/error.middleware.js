export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }

  const statusCode = err.statusCode || 500
  const rawMessage = err.message || ''

  console.error('[API Error]', rawMessage)

  const body = {
    success: false,
    // Pesan error 5xx sering memuat detail Prisma atau URL upstream (termasuk
    // nama instance Evolution); hanya error 4xx yang boleh dikirim apa adanya.
    message:
      statusCode < 500 && rawMessage ? rawMessage : 'Terjadi kesalahan pada server',
  }
  if (err.statusCode && typeof err.code === 'string') {
    body.code = err.code
  }

  return res.status(statusCode).json(body)
}
