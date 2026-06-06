import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'
import { redisGet, redisSet, redisDel, redisKeys } from './redis.js'

const CONFIG_CACHE_TTL = 600

const userConfigCache = new Map()

async function populateCacheFromRedis(userId) {
  const cached = await redisGet(`tenant_config:${userId}`)
  if (cached) {
    const creds = new Map(Object.entries(cached.creds || {}))
    userConfigCache.set(userId, { config: cached.config, creds })
    return cached.config
  }
  return null
}

async function persistCacheToRedis(userId, config, creds) {
  const credsObj = Object.fromEntries(creds)
  await redisSet(`tenant_config:${userId}`, { config, creds: credsObj }, CONFIG_CACHE_TTL)
}

export async function loadConfigForUser(userId) {
  if (userConfigCache.has(userId)) {
    return userConfigCache.get(userId).config
  }

  const fromRedis = await populateCacheFromRedis(userId)
  if (fromRedis) return fromRedis

  try {
    const config = await prisma.botConfig.findFirst({
      where: { userId, isActive: true },
    })

    if (!config) {
      console.warn(`[Config] BotConfig tidak ditemukan untuk user ${userId}`)
      return null
    }

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

    userConfigCache.set(userId, { config, creds })
    await persistCacheToRedis(userId, config, creds)
    return config
  } catch (err) {
    console.error(`[Config] Error load config user ${userId}:`, err.message)
    return null
  }
}

export async function loadCredsForUser(userId) {
  if (userConfigCache.has(userId)) {
    return userConfigCache.get(userId).creds
  }

  await loadConfigForUser(userId)
  const cached = userConfigCache.get(userId)
  return cached?.creds || null
}

export async function reloadConfigForUser(userId) {
  userConfigCache.delete(userId)
  await redisDel(`tenant_config:${userId}`)
  return loadConfigForUser(userId)
}

export async function reloadAllConfigs() {
  userConfigCache.clear()
  const keys = await redisKeys('tenant_config:*')
  if (keys.length > 0) {
    await redisDel(...keys)
  }
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

