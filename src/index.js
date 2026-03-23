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
import { startWebhookServer, setBotInstance } from './webhook.js'
import { initAdminBot } from './services/adminBot.js'

const { TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, BOT_MODE, WEBHOOK_PORT } =
  process.env

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN tidak ditemukan')
  process.exit(1)
}
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY tidak ditemukan')
  process.exit(1)
}

const isPolling = BOT_MODE !== 'webhook'
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: isPolling })

// Daftarkan bot ke webhook server agar bisa kirim notif setelah pembayaran
setBotInstance(bot)

// Inisialisasi admin bot (bot terpisah untuk notifikasi ke admin)
initAdminBot()

// Jalankan webhook server untuk notifikasi Midtrans
const port = parseInt(WEBHOOK_PORT || '3000')
startWebhookServer(port)

console.log('🤖 Bot Telegram AI dimulai...')
console.log(`📡 Mode: ${isPolling ? 'Polling' : 'Webhook'}`)

// ── Command Handler ──────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => handleStart(bot, msg))
bot.onText(/\/help/, (msg) => handleHelp(bot, msg))
bot.onText(/\/reset/, (msg) => handleReset(bot, msg))
bot.onText(/\/menu/, (msg) => handleMenu(bot, msg))
bot.onText(/\/pesan/, (msg) => handlePesan(bot, msg))
bot.onText(/\/konfirmasi/, (msg) => handleKonfirmasi(bot, msg))
bot.onText(/\/batal/, (msg) => handleBatal(bot, msg))

bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) handleMessage(bot, msg)
})

// ── Error Handling ───────────────────────────────────────────────────────────
bot.on('polling_error', (err) =>
  console.error('❌ Polling error:', err.message),
)
bot.on('error', (err) => console.error('❌ Bot error:', err.message))
process.on('uncaughtException', (err) => console.error('❌ Uncaught:', err))
process.on('unhandledRejection', (err) => console.error('❌ Unhandled:', err))
process.on('SIGINT', async () => {
  console.log('\n⏹️  Menghentikan bot...')
  if (isPolling) await bot.stopPolling()
  process.exit(0)
})

console.log('✅ Bot siap menerima pesan!')
