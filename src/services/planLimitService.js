// src/services/planLimitService.js
// Sentralisasi semua definisi limit per plan. Ini satu-satunya tempat angka limit didefinisikan.

import { redisGet, redisSet, redisIncr, redisExpire } from './redis.js'

const MONTHLY_ORDER_TTL = 86400 * 32 // ~32 days, covers longest month

function monthlyKey(userId) {
  const now = new Date()
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  return `monthly_orders:${userId}:${yyyymm}`
}

export const PLAN_LIMITS = {
  FREE: {
    botConfigs: 1,
    products: 10,
    maxBroadcastsPerMonth: 0,
    maxOrdersPerMonth: 10,
  },
  STARTER: {
    botConfigs: 1,
    products: 50,
    maxBroadcastsPerMonth: 50,
    maxOrdersPerMonth: 200,
  },
  PRO: {
    botConfigs: 1,
    products: Infinity,
    maxBroadcastsPerMonth: Infinity,
    maxOrdersPerMonth: Infinity,
  },
}

export const PLAN_PRICES = {
  STARTER: { MONTHLY: 35000, YEARLY: 350000 },
  PRO:     { MONTHLY: 100000, YEARLY: 1000000 },
}

/**
 * Cek apakah tenant masih dalam batas limit plan mereka.
 * Throw error jika limit terlampaui.
 */
export async function assertWithinLimit(userId, resource, prisma) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  const limits = PLAN_LIMITS[user.plan]

  if (resource === 'botConfig') {
    const count = await prisma.botConfig.count({ where: { userId } })
    if (count >= limits.botConfigs) {
      throw Object.assign(
        new Error(`Plan ${user.plan} hanya mendukung ${limits.botConfigs} bot config`),
        { code: 'PLAN_LIMIT_EXCEEDED', statusCode: 403 }
      )
    }
  }

  if (resource === 'product') {
    if (limits.products === Infinity) return
    const count = await prisma.product.count({ where: { userId, deletedAt: null } })
    if (count >= limits.products) {
      throw Object.assign(
        new Error(`Plan ${user.plan} hanya mendukung ${limits.products} produk`),
        { code: 'PLAN_LIMIT_EXCEEDED', statusCode: 403 }
      )
    }
  }
}

/**
 * Cek apakah tenant boleh menggunakan fitur tertentu.
 */
export function assertFeatureAllowed(plan, feature) {
  const limits = PLAN_LIMITS[plan]
  if (!limits[feature]) {
    throw Object.assign(
      new Error(`Fitur ini tidak tersedia di plan ${plan}`),
      { code: 'FEATURE_NOT_ALLOWED', statusCode: 403 }
    )
  }
}

/**
 * Dapatkan limit untuk plan tertentu.
 */
export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.FREE
}

/**
 * Dapatkan harga untuk plan dan interval tertentu.
 */
export function getPlanPrice(plan, interval = 'MONTHLY') {
  return PLAN_PRICES[plan]?.[interval]
}

/**
 * Hitung jumlah order COMPLETED bulan ini untuk tenant.
 * — Coba dari Redis counter dulu, fallback ke DB.
 */
async function countCompletedOrdersThisMonth(userId, prisma) {
  const key = monthlyKey(userId)
  const cached = await redisGet(key).catch(() => null)
  if (cached !== null) return Number(cached)

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const count = await prisma.order.count({
    where: {
      userId,
      status: 'COMPLETED',
      paidAt: { gte: startOfMonth },
    },
  })

  await redisSet(key, count, MONTHLY_ORDER_TTL).catch(() => {})
  return count
}

/**
 * Increment monthly order counter di Redis.
 * Dipanggil saat order sukses COMPLETED.
 */
export async function incrementMonthlyOrderCount(userId) {
  const key = monthlyKey(userId)
  const count = await redisIncr(key).catch(() => null)
  if (count === 1) {
    await redisExpire(key, MONTHLY_ORDER_TTL).catch(() => {})
  }
}

/**
 * Cek apakah tenant masih dalam batas order bulanan.
 * Throw error dengan kode PLAN_LIMIT_EXCEEDED jika terlampaui.
 */
function monthlyBroadcastKey(userId) {
  const now = new Date()
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  return `monthly_broadcasts:${userId}:${yyyymm}`
}

export async function assertMonthlyBroadcastLimit(userId, prisma) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  const limits = PLAN_LIMITS[user.plan]
  if (limits.maxBroadcastsPerMonth === Infinity) return

  const key = monthlyBroadcastKey(userId)
  const cached = await redisGet(key).catch(() => null)
  const count = cached !== null ? Number(cached) : await prisma.broadcast.count({
    where: {
      userId,
      status: { in: ['SENDING', 'SENT'] },
      createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    },
  })

  if (count >= limits.maxBroadcastsPerMonth) {
    throw Object.assign(
      new Error(`Batas broadcast bulanan plan ${user.plan} telah tercapai. Upgrade plan untuk menambah kapasitas.`),
      { code: 'MONTHLY_BROADCAST_LIMIT_EXCEEDED', statusCode: 403 }
    )
  }
}

export async function incrementMonthlyBroadcastCount(userId) {
  const key = monthlyBroadcastKey(userId)
  const count = await redisIncr(key).catch(() => null)
  if (count === 1) {
    await redisExpire(key, MONTHLY_ORDER_TTL).catch(() => {})
  }
}

export async function assertMonthlyOrderLimit(userId, prisma) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  const limits = PLAN_LIMITS[user.plan]
  if (limits.maxOrdersPerMonth === Infinity) return

  const count = await countCompletedOrdersThisMonth(userId, prisma)
  if (count >= limits.maxOrdersPerMonth) {
    throw Object.assign(
      new Error(`Batas order bulanan plan ${user.plan} telah tercapai. Hubungi admin untuk upgrade plan.`),
      { code: 'MONTHLY_ORDER_LIMIT_EXCEEDED', statusCode: 403 }
    )
  }
}