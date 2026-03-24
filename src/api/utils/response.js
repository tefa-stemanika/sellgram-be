export function ok(res, data, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  })
}

export function fail(res, message, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message,
  })
}
