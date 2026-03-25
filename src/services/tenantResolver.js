// src/services/tenantResolver.js
// Service untuk menentukan user (tenant) dari bot token atau from incoming message.
// Ini adalah core dari multi-tenant logic.

import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'

/**
 * Cache: Map<botToken, userId>
 * Diisi saat startup, di-clear jika ada perubahan credentials.
 */
let tokenUserMap = new Map()
let mapInitialized = false

/**
 * Inisialisasi cache token->userId dari database.
 * Dipanggil sekali saat startup.
 */
export async function initializeTenantMap() {
  try {
    // Ambil semua credentials TELEGRAM_BOT_TOKEN dari semua user
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

/**
 * Cari userId dari bot token.
 * Return: userId atau null jika tidak ditemukan.
 */
export function resolveUserIdFromToken(botToken) {
  const userId = tokenUserMap.get(botToken)
  if (!userId) {
    console.warn(`[TenantResolver] Token tidak ditemukan di map.`)
    return null
  }
  return userId
}

/**
 * Cari userId dari Telegram message.
 * Perlu tahu bot token yang menerima message tersebut.
 */
export function resolveUserIdFromMessage(msg, botTokenParam) {
  // Cara ke-1: dari parameter token (jika diketahui)
  if (botTokenParam) {
    return resolveUserIdFromToken(botTokenParam)
  }

  // Cara ke-2: nanti bisa di-extend untuk callback query atau inline response

  return null
}

/**
 * Refresh tenant map (dipanggil saat ada perubahan credentials).
 */
export async function refreshTenantMap() {
  return initializeTenantMap()
}

/**
 * Cek apakah tenant map sudah diinisialisasi.
 */
export function isTenantMapReady() {
  return mapInitialized
}

/**
 * Dapatkan semua token yang terdaftar (untuk debugging).
 */
export function getRegisteredTokens() {
  return Array.from(tokenUserMap.keys())
}

/**
 * Get statistics.
 */
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
