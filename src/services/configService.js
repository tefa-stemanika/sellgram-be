import prisma from './db.js'
import { decrypt } from '../utils/encryption.js'
import { redisGet, redisSet, redisDel, redisKeys } from './redis.js'

const CONFIG_CACHE_TTL = 600

async function loadAndCacheConfig(userId) {
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

    const creds = {}
    for (const row of credsRows) {
      try {
        creds[row.key] = decrypt(row.value)
      } catch (err) {
        console.error(
          `[Config] Gagal dekripsi credential "${row.key}" user ${userId}:`,
          err.message,
        )
      }
    }

    await redisSet(`tenant_config:${userId}`, { config, creds }, CONFIG_CACHE_TTL)
    return { config, creds }
  } catch (err) {
    console.error(`[Config] Error load config user ${userId}:`, err.message)
    return null
  }
}

export async function loadConfigForUser(userId) {
  const cached = await redisGet(`tenant_config:${userId}`)
  if (cached) return cached.config

  const result = await loadAndCacheConfig(userId)
  return result?.config || null
}

export async function loadCredsForUser(userId) {
  const cached = await redisGet(`tenant_config:${userId}`)
  if (cached) return cached.creds

  const result = await loadAndCacheConfig(userId)
  return result?.creds || null
}

export async function reloadConfigForUser(userId) {
  await redisDel(`tenant_config:${userId}`)
  return loadConfigForUser(userId)
}

export async function reloadAllConfigs() {
  const keys = await redisKeys('tenant_config:*')
  if (keys.length > 0) {
    await redisDel(...keys)
  }
  console.log('[Config] Semua config di-reset')
}

// ── Getter per userId ──────────────────────────────────────────────────────────

export async function getCredentialForUser(userId, key) {
  const cached = await redisGet(`tenant_config:${userId}`)
  if (!cached) return null
  return cached.creds?.[key] || null
}

export async function getBotConfigForUser(userId) {
  const cached = await redisGet(`tenant_config:${userId}`)
  if (!cached) return null
  return cached.config
}

// ── Shortcut getters untuk user tertentu ───────────────────────────────────────

export async function getTelegramTokenForUser(userId) {
  return getCredentialForUser(userId, 'TELEGRAM_BOT_TOKEN')
}

export async function getAdminBotTokenForUser(userId) {
  return getCredentialForUser(userId, 'ADMIN_BOT_TOKEN')
}

export async function getAdminChatIdForUser(userId) {
  return getCredentialForUser(userId, 'ADMIN_CHAT_ID')
}

export async function getMidtransServerKeyForUser(userId) {
  const config = await getBotConfigForUser(userId)
  const key = config?.midtransIsProduction
    ? 'MIDTRANS_SERVER_KEY_PRODUCTION'
    : 'MIDTRANS_SERVER_KEY_SANDBOX'
  return getCredentialForUser(userId, key)
}

export async function getMidtransClientKeyForUser(userId) {
  const config = await getBotConfigForUser(userId)
  const key = config?.midtransIsProduction
    ? 'MIDTRANS_CLIENT_KEY_PRODUCTION'
    : 'MIDTRANS_CLIENT_KEY_SANDBOX'
  return getCredentialForUser(userId, key)
}

export async function isMidtransProductionForUser(userId) {
  const config = await getBotConfigForUser(userId)
  return config?.midtransIsProduction || false
}

export async function getBotModeForUser(userId) {
  const config = await getBotConfigForUser(userId)
  return config?.mode || 'AI'
}
