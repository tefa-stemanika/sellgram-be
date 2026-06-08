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

export function okPaginated(res, items, total, page, limit, message = 'OK') {
  return res.status(200).json({
    success: true,
    message,
    data: normalizeJsonValue(items),
    metadata: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 0,
    },
  })
}

export function fail(res, message, statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    message,
  })
}
