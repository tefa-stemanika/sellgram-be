// src/services/configService.js
// Multi-tenant config service — mengelola config per user (tenant).
// Cache di memory agar tidak query DB di setiap pesan.

import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'

// ── Cache per userId ───────────────────────────────────────────────────────────
// Map<userId, { config: BotConfig, creds: Map<key, value> }>

const userConfigCache = new Map()

/**
 * Load config untuk user tertentu.
 * Jika sudah di-cache, return dari cache.
 * Jika belum, load dari DB dan cache.
 */
export async function loadConfigForUser(userId) {
  // Cek cache dulu
  if (userConfigCache.has(userId)) {
    return userConfigCache.get(userId).config
  }

  try {
    // Ambil BotConfig user yang aktif
    const config = await prisma.botConfig.findFirst({
      where: { userId, isActive: true },
    })

    if (!config) {
      console.warn(`[Config] BotConfig tidak ditemukan untuk user ${userId}`)
      return null
    }

    // Ambil semua credentials user
    const credsRows = await prisma.botCredential.findMany({
      where: { userId },
    })

    const creds = new Map()
    for (const row of credsRows) {
      try {
        creds.set(row.key, decrypt(row.value))
      } catch (err) {
        console.error(
          `[Config] Gagal dekripsi credential "${row.key}" user ${userId}:`,
          err.message,
        )
      }
    }

    // Simpan ke cache
    userConfigCache.set(userId, { config, creds })
    return config
  } catch (err) {
    console.error(`[Config] Error load config user ${userId}:`, err.message)
    return null
  }
}

/**
 * Load credentials untuk user (untuk internal use).
 */
export async function loadCredsForUser(userId) {
  if (userConfigCache.has(userId)) {
    return userConfigCache.get(userId).creds
  }

  // Force load
  await loadConfigForUser(userId)
  const cached = userConfigCache.get(userId)
  return cached?.creds || null
}

/**
 * Reload config user (dipanggil saat ada perubahan via dashboard).
 */
export async function reloadConfigForUser(userId) {
  userConfigCache.delete(userId)
  return loadConfigForUser(userId)
}

/**
 * Reload semua config (saat startup atau admin action).
 */
export async function reloadAllConfigs() {
  userConfigCache.clear()
  console.log('[Config] Semua config di-reset')
}

// ── Getter per userId ──────────────────────────────────────────────────────────

function getUserCache(userId) {
  const cached = userConfigCache.get(userId)
  if (!cached) {
    return null
  }
  return cached
}

/**
 * Ambil satu credential user (sudah didekripsi).
 */
export function getCredentialForUser(userId, key) {
  const cached = getUserCache(userId)
  if (!cached) return null
  return cached.creds.get(key) || null
}

/**
 * Ambil BotConfig user lengkap.
 */
export function getBotConfigForUser(userId) {
  const cached = getUserCache(userId)
  if (!cached) return null
  return cached.config
}

// ── Shortcut getters untuk user tertentu ───────────────────────────────────────

export function getTelegramTokenForUser(userId) {
  return getCredentialForUser(userId, 'TELEGRAM_BOT_TOKEN')
}

export function getAdminBotTokenForUser(userId) {
  return getCredentialForUser(userId, 'ADMIN_BOT_TOKEN')
}

export function getAdminChatIdForUser(userId) {
  return getCredentialForUser(userId, 'ADMIN_CHAT_ID')
}

export function getGeminiApiKeyForUser(userId) {
  return getCredentialForUser(userId, 'GEMINI_API_KEY')
}

export function getMidtransServerKeyForUser(userId) {
  return getCredentialForUser(userId, 'MIDTRANS_SERVER_KEY')
}

export function getMidtransClientKeyForUser(userId) {
  return getCredentialForUser(userId, 'MIDTRANS_CLIENT_KEY')
}

export function getGeminiModelForUser(userId) {
  const config = getBotConfigForUser(userId)
  return config?.geminiModel || 'gemini-2.0-flash'
}

export function isAiEnabledForUser(userId) {
  const config = getBotConfigForUser(userId)
  return config?.aiEnabled ?? false
}

export function isMidtransProductionForUser(userId) {
  const config = getBotConfigForUser(userId)
  return config?.midtransIsProduction || false
}

// ── Legacy single-tenant getters (backwards compatibility) ──────────────────────
// Untuk migrasi gradual, tetap support single-user scenario.
// Anggap userId = 1 sebagai default.

const DEFAULT_USER_ID = 1

/**
 * Load config user default (migrasi backward-compat).
 */
export async function loadConfig() {
  return loadConfigForUser(DEFAULT_USER_ID)
}

export function getCredential(key) {
  return getCredentialForUser(DEFAULT_USER_ID, key)
}

export function getBotConfig() {
  return getBotConfigForUser(DEFAULT_USER_ID)
}

export function getTelegramToken() {
  return getTelegramTokenForUser(DEFAULT_USER_ID)
}

export function getAdminBotToken() {
  return getAdminBotTokenForUser(DEFAULT_USER_ID)
}

export function getAdminChatId() {
  return getAdminChatIdForUser(DEFAULT_USER_ID)
}

export function getGeminiApiKey() {
  return getGeminiApiKeyForUser(DEFAULT_USER_ID)
}

export function getMidtransServerKey() {
  return getMidtransServerKeyForUser(DEFAULT_USER_ID)
}

export function getMidtransClientKey() {
  return getMidtransClientKeyForUser(DEFAULT_USER_ID)
}

export function getGeminiModel() {
  return getGeminiModelForUser(DEFAULT_USER_ID)
}

export function isAiEnabled() {
  return isAiEnabledForUser(DEFAULT_USER_ID)
}

export function isMidtransProduction() {
  return isMidtransProductionForUser(DEFAULT_USER_ID)
}
