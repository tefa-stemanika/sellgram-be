import { redisLpush, redisLrange, redisLtrim, redisDel, redisKeys, redisExpire } from './redis.js'

const MAX_HISTORY = 20
const SESSION_TTL = 1800

function redisKey(userId, telegramId) {
  return `session:${userId}:${telegramId}`
}

export async function getHistory(userId, telegramId) {
  const key = redisKey(userId, telegramId)
  const messages = await redisLrange(key, 0, -1)
  return messages || []
}

export async function addMessage(userId, telegramId, role, text) {
  const key = redisKey(userId, telegramId)
  await redisLpush(key, { role, text })
  await redisLtrim(key, 0, MAX_HISTORY - 1)
  await redisExpire(key, SESSION_TTL)
}

export async function clearHistory(userId, telegramId) {
  const key = redisKey(userId, telegramId)
  await redisDel(key)
}

export async function getSessionStats() {
  const keys = await redisKeys('session:*')
  const byUser = {}
  for (const k of keys) {
    const parts = k.split(':')
    const uid = parts[1]
    byUser[uid] = (byUser[uid] || 0) + 1
  }
  return {
    total: keys.length,
    byUser,
    maxPerUser: 50,
  }
}

export async function getActiveSessionCount() {
  const keys = await redisKeys('session:*')
  return keys.length
}
