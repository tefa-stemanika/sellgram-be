function normalizeJsonValue(value) {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue)
  }

  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = normalizeJsonValue(nestedValue)
    }
    return result
  }

  return value
}

export function ok(res, data, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data: normalizeJsonValue(data),
  })
}

export function fail(res, message, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message,
  })
}
