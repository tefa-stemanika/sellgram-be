import { redisGet, redisSet, redisDel, redisKeys } from './redis.js'

export const ORDER_STATE = {
  IDLE: 'idle',
  SELECTING_PRODUCT: 'selecting_product',
  SELECTING_QTY: 'selecting_qty',
  CONFIRMING: 'confirming',
}

const ORDER_TTL = 3600

function redisKey(userId, telegramId) {
  return `order:${userId}:${telegramId}`
}

export async function getOrder(userId, telegramId) {
  const key = redisKey(userId, telegramId)
  const data = await redisGet(key)
  return data || {
    state: ORDER_STATE.IDLE,
    selectedProduct: null,
    quantity: 0,
  }
}

export async function setOrder(userId, telegramId, data) {
  const key = redisKey(userId, telegramId)
  const current = await getOrder(userId, telegramId)
  await redisSet(key, { ...current, ...data }, ORDER_TTL)
}

export async function resetOrder(userId, telegramId) {
  const key = redisKey(userId, telegramId)
  await redisDel(key)
}

export async function getOrderStats() {
  const keys = await redisKeys('order:*')
  return {
    total: keys.length,
    active: keys.length,
    expired: 0,
  }
}

export function generateOrderId() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `ORD-${date}-${rand}`
}
