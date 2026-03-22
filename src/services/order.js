// src/services/order.js
// Manajemen state order per user menggunakan Map (in-memory)
//
// State machine:
//   idle → selecting_product → selecting_qty → confirming → idle

const orders = new Map()

// State yang valid
export const ORDER_STATE = {
  IDLE: 'idle',
  SELECTING_PRODUCT: 'selecting_product',
  SELECTING_QTY: 'selecting_qty',
  CONFIRMING: 'confirming',
}

/**
 * Dapatkan state order user saat ini.
 * @param {number} userId
 * @returns {object}
 */
export function getOrder(userId) {
  return (
    orders.get(userId) || {
      state: ORDER_STATE.IDLE,
      selectedProduct: null,
      quantity: 0,
    }
  )
}

/**
 * Set state order user.
 * @param {number} userId
 * @param {object} data - Partial update untuk state order
 */
export function setOrder(userId, data) {
  const current = getOrder(userId)
  orders.set(userId, { ...current, ...data })
}

/**
 * Reset order user ke state awal.
 * @param {number} userId
 */
export function resetOrder(userId) {
  orders.delete(userId)
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
