// src/utils/password.js
// Utility untuk hash dan verify password menggunakan bcrypt.

import bcrypt from 'bcrypt'

const SALT_ROUNDS = 10

/**
 * Hash password dengan bcrypt.
 */
export async function hash(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

/**
 * Verify password vs hash.
 */
export async function verify(plainPassword, hashPassword) {
  return bcrypt.compare(plainPassword, hashPassword)
}
