// src/services/order.js
// Manajemen state order per (userId, telegramId) menggunakan Map (in-memory)
// Supports multi-tenant: setiap user punya order state terpisah per telegram user
//
// State machine:
//   idle → selecting_product → selecting_qty → confirming → idle
//
// Multi-tenant key: `${userId}:${telegramId}`
// Expiry: 24 jam (cleanup otomatis)

const orders = new Map() // Map<userIdTelegramId, state>
const orderTimestamps = new Map() // Track creation time untuk cleanup

const EXPIRY_TIME = 24 * 60 * 60 * 1000 // 24 jam dalam milliseconds

// State yang valid
export const ORDER_STATE = {
  IDLE: 'idle',
  SELECTING_PRODUCT: 'selecting_product',
  SELECTING_QTY: 'selecting_qty',
  CONFIRMING: 'confirming',
}

/**
 * Generate composite key untuk order state.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @returns {string} key format: "userId:telegramId"
 */
function getOrderKey(userId, telegramId) {
  return `${userId}:${telegramId}`
}

/**
 * Dapatkan state order user saat ini.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @returns {object} State object dengan structure {state, selectedProduct, quantity, ...}
 */
export function getOrder(userId, telegramId) {
  const key = getOrderKey(userId, telegramId)
  cleanupExpiredOrders()
  return (
    orders.get(key) || {
      state: ORDER_STATE.IDLE,
      selectedProduct: null,
      quantity: 0,
    }
  )
}

/**
 * Set state order user.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 * @param {object} data - Partial update untuk state order
 */
export function setOrder(userId, telegramId, data) {
  const key = getOrderKey(userId, telegramId)
  const current = getOrder(userId, telegramId)
  orders.set(key, { ...current, ...data })
  orderTimestamps.set(key, Date.now())
}

/**
 * Reset order user ke state awal.
 * @param {number} userId - Tenant user ID
 * @param {number} telegramId - Telegram chat ID
 */
export function resetOrder(userId, telegramId) {
  const key = getOrderKey(userId, telegramId)
  orders.delete(key)
  orderTimestamps.delete(key)
}

/**
 * Hapus order yang sudah lebih dari 24 jam.
 * Dipanggil otomatis di getOrder().
 * @private
 */
function cleanupExpiredOrders() {
  const now = Date.now()
  for (const [key, timestamp] of orderTimestamps.entries()) {
    if (now - timestamp > EXPIRY_TIME) {
      orders.delete(key)
      orderTimestamps.delete(key)
    }
  }
}

/**
 * Dapatkan statistik order state.
 * @returns {object} {total, active, expired}
 */
export function getOrderStats() {
  cleanupExpiredOrders()
  return {
    total: orders.size,
    active: orders.size,
    expired: orderTimestamps.size, // ini akan sudah 0 setelah cleanup
  }
}

/**
 * Generate nomor order unik (simulasi).
 * Format: ORD-YYYYMMDD-XXXX
 * @returns {string}
 */
export function generateOrderId() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `ORD-${date}-${rand}`
}
