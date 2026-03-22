// src/index.js
import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import {
  handleStart,
  handleHelp,
  handleReset,
  handleMessage,
} from './handlers/messageHandler.js'
import {
  handleMenu,
  handlePesan,
  handleKonfirmasi,
  handleBatal,
} from './handlers/orderHandler.js'

const { TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, BOT_MODE } = process.env

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN tidak ditemukan di .env')
  process.exit(1)
}

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY tidak ditemukan di .env')
  process.exit(1)
}

const isPolling = BOT_MODE !== 'webhook'

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: isPolling })

console.log('🤖 Bot Telegram AI dimulai...')
console.log(
  `📡 Mode: ${isPolling ? 'Polling (development)' : 'Webhook (production)'}`,
)

// ── Command Handler ──────────────────────────────────────────────────────────

// Chat
bot.onText(/\/start/, (msg) => handleStart(bot, msg))
bot.onText(/\/help/, (msg) => handleHelp(bot, msg))
bot.onText(/\/reset/, (msg) => handleReset(bot, msg))

// Order
bot.onText(/\/menu/, (msg) => handleMenu(bot, msg))
bot.onText(/\/pesan/, (msg) => handlePesan(bot, msg))
bot.onText(/\/konfirmasi/, (msg) => handleKonfirmasi(bot, msg))
bot.onText(/\/batal/, (msg) => handleBatal(bot, msg))

// Semua pesan teks yang bukan command
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    handleMessage(bot, msg)
  }
})

// ── Error Handling ───────────────────────────────────────────────────────────

bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message)
})

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message)
})

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason)
})

process.on('SIGINT', async () => {
  console.log('\n⏹️  Menghentikan bot...')
  if (isPolling) await bot.stopPolling()
  process.exit(0)
})

console.log('✅ Bot siap menerima pesan!')
