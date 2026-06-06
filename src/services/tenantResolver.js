import crypto from 'crypto'
import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'
import { redisGet, redisSet, redisDel, redisKeys } from './redis.js'

const TENANT_MAP_TTL = 600

let initialized = false

export async function initializeTenantMap() {
  try {
    const creds = await prisma.botCredential.findMany({
      where: { key: 'TELEGRAM_BOT_TOKEN' },
      include: { user: { select: { id: true, isActive: true } } },
    })

    let count = 0

    for (const cred of creds) {
      if (!cred.user.isActive) continue

      try {
        const token = decrypt(cred.value)
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
        await redisSet(`tenant_map:${tokenHash}`, cred.userId, TENANT_MAP_TTL)
        count++
      } catch (err) {
        console.error(
          `[TenantResolver] Gagal dekripsi token user ${cred.userId}:`,
          err.message,
        )
      }
    }

    initialized = true
    console.log(`✅ Tenant map diinisialisasi (${count} token bot terdaftar)`)
    return true
  } catch (err) {
    console.error('[TenantResolver] Gagal init tenant map:', err.message)
    return false
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

export async function resolveUserIdFromToken(botToken) {
  const tokenHash = hashToken(botToken)
  return redisGet(`tenant_map:${tokenHash}`)
}

export async function resolveUserIdFromMessage(msg, botTokenParam) {
  if (botTokenParam) {
    return resolveUserIdFromToken(botTokenParam)
  }
  return null
}

export async function refreshTenantMap() {
  const keys = await redisKeys('tenant_map:*')
  if (keys.length > 0) {
    await redisDel(...keys)
  }
  return initializeTenantMap()
}

export function isTenantMapReady() {
  return initialized
}

export function getRegisteredTokens() {
  return []
}

export function getTenantResolverStats() {
  return {
    isReady: initialized,
    registeredBots: -1,
  }
}

export async function findUserFromTelegramId(telegramId) {
  const order = await prisma.order.findFirst({
    where: { telegramId: BigInt(telegramId) },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  })

  return order?.userId || null
}

export async function findUserFromOrderId(orderId) {
  const order = await prisma.order.findFirst({
    where: { orderId },
    select: { userId: true },
  })

  return order?.userId || null
}
