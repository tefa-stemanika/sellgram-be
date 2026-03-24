// src/services/session.js
// Manajemen sesi per (userId, telegramId) — menyimpan riwayat chat di memory
// Supports multi-tenant: setiap (userId, telegramId) pair punya sesinya sendiri
// Untuk production, bisa diganti dengan Redis atau database
//
// Multi-tenant key: `${userId}:${telegramId}`
// Expiry: 24 jam (cleanup otomatis)
// Limit: MAX_HISTORY pesan per sesi + max 50 sesi aktif per user

const sessions = new Map() // Map<userIdTelegramId, Array<message>>
const sessionTimestamps = new Map() // Track creation time untuk cleanup

// Maksimal pesan yang disimpan per sesi (untuk hemat token)
const MAX_HISTORY = 20
// Maksimal sesi aktif per user (untuk hemat memory)
const MAX_SESSIONS_PER_USER = 50
const EXPIRY_TIME = 24 * 60 * 60 * 1000 // 24 jam dalam milliseconds

/**
 * Generate composite key untuk session.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @returns {string} key format: "userId:telegramId"
 */
function getSessionKey(userId, telegramId) {
  return `${userId}:${telegramId}`
}

/**
 * Dapatkan riwayat percakapan user.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @returns {Array} conversationHistory
 */
export function getHistory(userId, telegramId) {
  const key = getSessionKey(userId, telegramId)
  cleanupExpiredSessions()
  return sessions.get(key) || []
}

/**
 * Tambahkan pesan ke riwayat percakapan user.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @param {"user"|"model"} role - Role pesan
 * @param {string} text - Isi pesan
 */
export function addMessage(userId, telegramId, role, text) {
  const key = getSessionKey(userId, telegramId)

  if (!sessions.has(key)) {
    // Check limit sessions per user
    const userSessions = getUserSessions(userId)
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      // Hapus sesi paling lama untuk user ini
      const oldestKey = userSessions[0]
      sessions.delete(oldestKey)
      sessionTimestamps.delete(oldestKey)
    }
    sessions.set(key, [])
  }

  const history = sessions.get(key)
  history.push({ role, text })

  // Batasi panjang riwayat agar tidak terlalu panjang
  if (history.length > MAX_HISTORY) {
    // Hapus 2 pesan paling lama (1 pasang user-model)
    history.splice(0, 2)
  }

  sessions.set(key, history)
  sessionTimestamps.set(key, Date.now())
}

/**
 * Reset riwayat percakapan user.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 */
export function clearHistory(userId, telegramId) {
  const key = getSessionKey(userId, telegramId)
  sessions.delete(key)
  sessionTimestamps.delete(key)
}

/**
 * Dapatkan list semua sesi aktif untuk user tertentu.
 * @param {number} userId - Tenant user ID
 * @returns {Array<string>} List session keys untuk user ini
 * @private
 */
function getUserSessions(userId) {
  const prefix = `${userId}:`
  return Array.from(sessions.keys()).filter((key) => key.startsWith(prefix))
}

/**
 * Hapus sesi yang sudah lebih dari 24 jam.
 * Dipanggil otomatis di getHistory().
 * @private
 */
function cleanupExpiredSessions() {
  const now = Date.now()
  for (const [key, timestamp] of sessionTimestamps.entries()) {
    if (now - timestamp > EXPIRY_TIME) {
      sessions.delete(key)
      sessionTimestamps.delete(key)
    }
  }
}

/**
 * Dapatkan statistik sessions aktif.
 * @returns {object} {total, byUser, maxPerUser}
 */
export function getSessionStats() {
  cleanupExpiredSessions()
  const byUser = new Map()

  for (const key of sessions.keys()) {
    const [userId] = key.split(':')
    byUser.set(userId, (byUser.get(userId) || 0) + 1)
  }

  return {
    total: sessions.size,
    byUser: Object.fromEntries(byUser),
    maxPerUser: MAX_SESSIONS_PER_USER,
  }
}

/**
 * Dapatkan jumlah sesi aktif (untuk backward compatibility).
 * @returns {number}
 */
export function getActiveSessionCount() {
  cleanupExpiredSessions()
  return sessions.size
}
