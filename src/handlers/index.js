// src/handlers/index.js
// Handler registration wrapper — mendaftarkan semua handler untuk bot instance tertentu

import {
  handleStart,
  handleHelp,
  handleReset,
  handleMessage,
} from './messageHandler.js'
import {
  handleMenu,
  handlePesan,
  handleKonfirmasi,
  handleBatal,
  handleOrderStatus,
} from './orderHandler.js'
import { handleCallbackQuery } from './buttonHandler.js'

/**
 * Daftarkan semua command, message, dan callback handlers untuk bot instance tertentu.
 * Setiap handler menerima userId sebagai parameter untuk multi-tenant support.
 *
 * @param {TelegramBot} bot - Bot instance untuk user tertentu
 * @param {number} userId - User ID (tenant) yang merupakan pemilik bot
 * @param {object} config - Konfigurasi untuk user ini (opsional, untuk context handler)
 */
export function registerHandlersForUser(bot, userId, config = {}) {
  console.log(
    `[Handler Registration] Registering handlers for userId=${userId}`,
  )

  // ────────────────────────────────────────────────────────────────────────────
  // Command Handlers (/start, /help, /reset, /menu, /pesan, /konfirmasi, /batal)
  // ────────────────────────────────────────────────────────────────────────────

  bot.onText(/^\/start/, async (msg) => {
    try {
      await handleStart(bot, msg, userId)
    } catch (error) {
      console.error(`[/start error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/help/, async (msg) => {
    try {
      await handleHelp(bot, msg, userId)
    } catch (error) {
      console.error(`[/help error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/reset/, async (msg) => {
    try {
      await handleReset(bot, msg, userId)
    } catch (error) {
      console.error(`[/reset error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/menu/, async (msg) => {
    try {
      await handleMenu(bot, msg, userId)
    } catch (error) {
      console.error(`[/menu error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/pesan/, async (msg) => {
    try {
      await handlePesan(bot, msg, userId)
    } catch (error) {
      console.error(`[/pesan error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/konfirmasi/, async (msg) => {
    try {
      await handleKonfirmasi(bot, msg, userId)
    } catch (error) {
      console.error(`[/konfirmasi error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/batal/, async (msg) => {
    try {
      await handleBatal(bot, msg, userId)
    } catch (error) {
      console.error(`[/batal error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  bot.onText(/^\/status/, async (msg) => {
    try {
      await handleOrderStatus(bot, msg, userId)
    } catch (error) {
      console.error(`[/status error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Callback Query Handler (button clicks)
  // ────────────────────────────────────────────────────────────────────────────

  bot.on('callback_query', async (query) => {
    try {
      await handleCallbackQuery(bot, query, userId)
    } catch (error) {
      console.error(
        `[callback_query error for userId=${userId}]`,
        error.message,
      )
      try {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Kesalahan. Coba lagi.',
        })
      } catch {
        // Ignore if callback query already answered
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Regular Message Handler (teks umum, custom qty input, order flow)
  // ────────────────────────────────────────────────────────────────────────────

  bot.on('message', async (msg) => {
    try {
      // Abaikan command messages (sudah ditangani oleh onText handlers)
      if (msg.text?.startsWith('/')) return

      // Handle: natural language messages (tergantung AI_ENABLED config)
      //         custom qty input (setelah button "Jumlah lain...")
      //         order flow input (setelah pesan user)
      await handleMessage(bot, msg, userId)
    } catch (error) {
      console.error(`[message error for userId=${userId}]`, error.message)
      await bot.sendMessage(
        msg.chat.id,
        '❌ Terjadi kesalahan. Silakan coba lagi.',
      )
    }
  })

  console.log(
    `[Handler Registration] ✅ All handlers registered for userId=${userId}`,
  )
}

/**
 * Register handlers untuk multiple bots (gunakan saat spawnAllActiveBots).
 * Iterasi melalui Map<userId, BotData> dan register handler untuk setiap bot.
 *
 * @param {Map} activeBots - Map dari userId → {bot, config, ...}
 */
export function registerHandlersForAllBots(activeBots) {
  for (const [userId, botData] of activeBots.entries()) {
    try {
      registerHandlersForUser(botData.bot, userId, botData.config)
    } catch (error) {
      console.error(
        `[Handler Registration Error] Failed to register for userId=${userId}:`,
        error.message,
      )
    }
  }
}
