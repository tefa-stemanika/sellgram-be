import crypto from 'crypto'
import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'
import { redisGet, redisSet, redisDel, redisKeys } from './redis.js'

const TENANT_MAP_TTL = 600

let tokenUserMap = new Map()
let mapInitialized = false

export async function initializeTenantMap() {
  try {
    const creds = await prisma.botCredential.findMany({
      where: { key: 'TELEGRAM_BOT_TOKEN' },
      include: { user: { select: { id: true, isActive: true } } },
    })

    tokenUserMap.clear()

    for (const cred of creds) {
      if (!cred.user.isActive) continue

      try {
        const token = decrypt(cred.value)
        tokenUserMap.set(token, cred.userId)
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
        await redisSet(`tenant_map:${tokenHash}`, cred.userId, TENANT_MAP_TTL)
      } catch (err) {
        console.error(
          `[TenantResolver] Gagal dekripsi token user ${cred.userId}:`,
          err.message,
        )
      }
    }

    mapInitialized = true
    console.log(
      `✅ Tenant map diinisialisasi (${tokenUserMap.size} token bot terdaftar)`,
    )
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
  const fromMemory = tokenUserMap.get(botToken)
  if (fromMemory) return fromMemory

  const tokenHash = hashToken(botToken)
  const fromRedis = await redisGet(`tenant_map:${tokenHash}`)
  if (fromRedis) {
    tokenUserMap.set(botToken, fromRedis)
    return fromRedis
  }

  console.warn(`[TenantResolver] Token tidak ditemukan.`)
  return null
}

export function resolveUserIdFromMessage(msg, botTokenParam) {
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
  return mapInitialized
}

export function getRegisteredTokens() {
  return Array.from(tokenUserMap.keys())
}

export function getTenantResolverStats() {
  return {
    isReady: mapInitialized,
    registerredBots: tokenUserMap.size,
  }
}

/**
 * Helper: Cari user dari Telegram chat ID.
 * Untuk use case: webhook notifikasi hanya punya order_id, perlu cari user-nya.
 */
export async function findUserFromTelegramId(telegramId) {
  // Cari order pertama (atau paling baru) dari telegram ID ini
  const order = await prisma.order.findFirst({
    where: { telegramId: BigInt(telegramId) },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  })

  return order?.userId || null
}

/**
 * Helper: Cari user dari order ID.
 * Untuk use case: webhook Midtrans punya order_id.
 */
export async function findUserFromOrderId(orderId) {
  const order = await prisma.order.findFirst({
    where: { orderId },
    select: { userId: true },
  })

  return order?.userId || null
}
