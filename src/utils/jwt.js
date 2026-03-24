import jwt from 'jsonwebtoken'

const DEFAULT_EXPIRES_IN = '7d'

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-jwt-secret-change-me'
}

export function signAuthToken(payload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN,
  })
}

export function verifyAuthToken(token) {
  return jwt.verify(token, getJwtSecret())
}
