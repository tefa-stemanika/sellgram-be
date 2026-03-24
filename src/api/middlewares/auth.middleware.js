import { fail } from '../utils/response.js'
import { verifyAuthToken } from '../../utils/jwt.js'

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const [scheme, token] = authHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return fail(res, 'Unauthorized', 401)
  }

  try {
    const decoded = verifyAuthToken(token)
    req.auth = { userId: decoded.userId }
    return next()
  } catch {
    return fail(res, 'Invalid or expired token', 401)
  }
}
