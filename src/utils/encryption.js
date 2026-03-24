// src/utils/encryption.js
// Enkripsi/dekripsi credentials menggunakan AES-256-GCM.
//
// Format yang disimpan di database: "iv:authTag:ciphertext" (semua hex)
//
// ENCRYPTION_KEY di .env harus berupa string 64 karakter hex (32 bytes).
// Generate dengan: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey() {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY tidak ditemukan di .env')
  if (raw.length !== 64)
    throw new Error('ENCRYPTION_KEY harus 64 karakter hex (32 bytes)')
  return Buffer.from(raw, 'hex')
}

/**
 * Enkripsi plaintext → string "iv:authTag:ciphertext"
 * @param {string} plaintext
 * @returns {string}
 */
export function encrypt(plaintext) {
  const key = getKey()
  const iv = crypto.randomBytes(12) // 96-bit IV untuk GCM

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

/**
 * Dekripsi string "iv:authTag:ciphertext" → plaintext
 * @param {string} encryptedString
 * @returns {string}
 */
export function decrypt(encryptedString) {
  const key = getKey()
  const [ivHex, authTagHex, ciphertextHex] = encryptedString.split(':')

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Format encrypted string tidak valid')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}
