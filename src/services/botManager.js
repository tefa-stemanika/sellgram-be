// src/services/botManager.js
// Mengelola spawn/stop instance bot per user (multi-tenant).
// Setiap user aktif mendapat satu instance bot yang berjalan dengan context userId-nya.

import TelegramBot from 'node-telegram-bot-api'
import { getUserById, canCreateNewBot } from './userService.js'
import { loadConfigForUser } from './configService.js'
import { getTelegramTokenForUser } from './configService.js'

/**
 * Map<userId, { botInstance, config, user }>
 */
const activeBots = new Map()

/**
 * Spawn bot instance untuk user tertentu.
 * Return: { botInstance, config, user } atau null jika gagal.
 */
export async function spawnBotForUser(userId, options = {}) {
  try {
    // Cek apakah user sudah punya bot running
    if (activeBots.has(userId)) {
      console.warn(`⚠️  Bot untuk user ${userId} sudah running.`)
      return activeBots.get(userId)
    }

    // Load user data
    const user = await getUserById(userId)
    if (!user || !user.isActive) {
      console.error(`❌ User ${userId} tidak ditemukan atau tidak aktif.`)
      return null
    }

    // Load config user
    const config = await loadConfigForUser(userId)
    if (!config) {
      console.error(`❌ Config tidak ditemukan untuk user ${userId}.`)
      return null
    }

    // Ambil token bot
    const token = getTelegramTokenForUser(userId)
    if (!token) {
      console.error(
        `❌ TELEGRAM_BOT_TOKEN tidak ditemukan untuk user ${userId}.`,
      )
      return null
    }

    // Tentukan mode polling vs webhook
    const isPolling = options.botMode !== 'webhook'

    // Spawn bot instance
    const bot = new TelegramBot(token, { polling: isPolling })

    // Simpan ke map
    const botData = { bot, config, user, userId }
    activeBots.set(userId, botData)

    console.log(`✅ Bot untuk user "${user.name}" (ID: ${userId}) spawned.`)
    return botData
  } catch (err) {
    console.error(`❌ Gagal spawn bot untuk user ${userId}:`, err.message)
    return null
  }
}

/**
 * Stop bot instance user tertentu.
 */
export async function stopBotForUser(userId) {
  const botData = activeBots.get(userId)
  if (!botData) {
    console.warn(`⚠️  Bot untuk user ${userId} tidak ditemukan.`)
    return false
  }

  try {
    if (botData.bot.isPolling()) {
      await botData.bot.stopPolling()
    }
    activeBots.delete(userId)
    console.log(`✅ Bot untuk user ${userId} dihentikan.`)
    return true
  } catch (err) {
    console.error(`❌ Gagal stop bot untuk user ${userId}:`, err.message)
    return false
  }
}

/**
 * Restart bot user (stop + spawn).
 */
export async function restartBotForUser(userId) {
  await stopBotForUser(userId)
  return spawnBotForUser(userId)
}

/**
 * Dapatkan bot instance user (sudah spawned).
 */
export function getBotForUser(userId) {
  const botData = activeBots.get(userId)
  return botData ? botData.bot : null
}

/**
 * Dapatkan semua info bot user.
 */
export function getBotDataForUser(userId) {
  return activeBots.get(userId) || null
}

/**
 * Cek apakah bot user aktif.
 */
export function isBotActive(userId) {
  return activeBots.has(userId)
}

/**
 * Spawn semua bot dari user yang active (saat startup).
 */
export async function spawnAllActiveBots() {
  const { getAllActiveUsers } = await import('./userService.js')
  const users = await getAllActiveUsers()

  console.log(`\n📊 Memulai ${users.length} bot instance...`)

  const results = {
    success: 0,
    failed: 0,
  }

  for (const user of users) {
    // Cek limit bot user
    const limit = canCreateNewBot(user)
    const botCount = user.botConfigs?.length || 0

    if (botCount > limit) {
      console.warn(
        `⚠️  User "${user.name}" sudah melebihi limit bot (${botCount}/${limit}).`,
      )
      results.failed++
      continue
    }

    // Spawn bot
    const botData = await spawnBotForUser(user.id, {
      botMode: user.botConfigs?.[0]?.botMode || 'polling',
    })

    if (botData) {
      results.success++
    } else {
      results.failed++
    }
  }

  console.log(
    `✅ Bot startup selesai: ${results.success} berhasil, ${results.failed} gagal\n`,
  )
  return results
}

/**
 * Stop semua bot (saat shutdown).
 */
export async function stopAllBots() {
  console.log('\n⏹️  Menghentikan semua bot instances...')

  const userIds = Array.from(activeBots.keys())
  let stopped = 0

  for (const userId of userIds) {
    const success = await stopBotForUser(userId)
    if (success) stopped++
  }

  console.log(`✅ ${stopped} bot dihentikan.\n`)
  return stopped
}

/**
 * Dapatkan statistik active bots.
 */
export function getBotsStatistics() {
  return {
    totalActiveBots: activeBots.size,
    userIds: Array.from(activeBots.keys()),
  }
}

/**
 * Get the activeBots Map<userId, botData> untuk registration purposes.
 */
export function getActiveBots() {
  return activeBots
}
