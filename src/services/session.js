// src/services/session.js
// Manajemen sesi per user — menyimpan riwayat chat di memory
// Untuk production, bisa diganti dengan Redis atau database

const sessions = new Map()

// Maksimal pesan yang disimpan per sesi (untuk hemat token)
const MAX_HISTORY = 20

/**
 * Dapatkan riwayat percakapan user.
 * @param {number} userId
 * @returns {Array} conversationHistory
 */
export function getHistory(userId) {
  return sessions.get(userId) || []
}

/**
 * Tambahkan pesan ke riwayat percakapan user.
 * @param {number} userId
 * @param {"user"|"model"} role
 * @param {string} text
 */
export function addMessage(userId, role, text) {
  if (!sessions.has(userId)) {
    sessions.set(userId, [])
  }

  const history = sessions.get(userId)
  history.push({ role, text })

  // Batasi panjang riwayat agar tidak terlalu panjang
  if (history.length > MAX_HISTORY) {
    // Hapus 2 pesan paling lama (1 pasang user-model)
    history.splice(0, 2)
  }

  sessions.set(userId, history)
}

/**
 * Reset riwayat percakapan user.
 * @param {number} userId
 */
export function clearHistory(userId) {
  sessions.delete(userId)
}

/**
 * Dapatkan jumlah user aktif.
 * @returns {number}
 */
export function getActiveSessionCount() {
  return sessions.size
}
