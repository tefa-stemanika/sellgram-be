import jwt from 'jsonwebtoken'
import { fail } from '../utils/response.js'

export function authenticateCustomer(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return fail(res, 'Unauthorized', 401)
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    if (payload.type !== 'customer') {
      return fail(res, 'Unauthorized', 401)
    }

    if (payload.tenantId !== req.params.userId) {
      return fail(res, 'Forbidden', 403)
    }

    req.customer = { id: payload.sub }
    req.tenantId = payload.tenantId
    next()
  } catch (e) {
    return fail(res, 'Token tidak valid atau sudah expired', 401)
  }
}
