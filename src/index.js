// src/index.js
import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'

// ── 1. Load config dari database SEBELUM import handler lain ─────────────────
// Handler mengambil AI_ENABLED saat module di-load, jadi config harus
// sudah tersedia di memory sebelum import mereka terjadi.
import { loadConfig, getTelegramToken } from './services/configService.js'

// Load config — jika gagal (DB tidak ada config), proses berhenti
await loadConfig()

// ── 2. Import handler setelah config siap ─────────────────────────────────────
import {
  handleStart,
  handleHelp,
  handleReset,
  handleMessage,
  AI_ENABLED,
} from './handlers/messageHandler.js'
import {
  handleMenu,
  handlePesan,
  handleKonfirmasi,
  handleBatal,
} from './handlers/orderHandler.js'
import {
  handleCallbackQuery,
  showMenuButtons,
} from './handlers/buttonHandler.js'
import { startWebhookServer, setBotInstance } from './webhook.js'
import { initAdminBot } from './services/adminBot.js'

// ── 3. Validasi token ─────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = getTelegramToken()
if (!TELEGRAM_BOT_TOKEN) {
  console.error(
    '❌ TELEGRAM_BOT_TOKEN tidak ditemukan di database credentials.',
  )
  console.error('   Jalankan: npm run db:seed-config')
  process.exit(1)
}

// ── 4. Inisialisasi bot & services ────────────────────────────────────────────
const isPolling = process.env.BOT_MODE !== 'webhook'
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: isPolling })

setBotInstance(bot)
initAdminBot()

const port = parseInt(process.env.WEBHOOK_PORT || '3000')
startWebhookServer(port)

console.log('🤖 Bot Telegram dimulai...')
console.log(`📡 Mode:    ${isPolling ? 'Polling' : 'Webhook'}`)
console.log(`🧠 AI Mode: ${AI_ENABLED ? 'ON (Gemini)' : 'OFF (Button UI)'}`)

// ── 5. Command Handler ────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => handleStart(bot, msg))
bot.onText(/\/help/, (msg) => handleHelp(bot, msg))
bot.onText(/\/reset/, (msg) => handleReset(bot, msg))

bot.onText(/\/menu/, (msg) => {
  if (AI_ENABLED) return handleMenu(bot, msg)
  return showMenuButtons(bot, msg.chat.id)
})

bot.onText(/\/pesan/, (msg) => {
  if (AI_ENABLED) handlePesan(bot, msg)
})
bot.onText(/\/konfirmasi/, (msg) => {
  if (AI_ENABLED) handleKonfirmasi(bot, msg)
})
bot.onText(/\/batal/, (msg) => handleBatal(bot, msg))

// ── 6. Callback Query (Inline Keyboard) ──────────────────────────────────────
bot.on('callback_query', (query) => {
  if (query.data === 'show_help') {
    bot.answerCallbackQuery(query.id)
    return handleHelp(bot, query.message)
  }
  return handleCallbackQuery(bot, query)
})

// ── 7. Semua pesan teks ───────────────────────────────────────────────────────
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) handleMessage(bot, msg)
})

// ── 8. Error Handling ─────────────────────────────────────────────────────────
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
