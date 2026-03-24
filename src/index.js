// src/index.js
// Entry point untuk MULTI-TENANT (M6) mode.
// Spawn bot instances untuk setiap user active, masing-masing dengan context userId.
//
// Jalankan: BOT_MODE=polling NODE_ENV=development node src/index.js

import 'dotenv/config'
import { createApp } from './app.js'

// ── 0. Init tenant resolver dulu (mapping token→userId) ──────────────────────
import { initializeTenantMap } from './services/tenantResolver.js'
await initializeTenantMap()

// ── 1. Spawn semua bot instances untuk user yang active ────────────────────────
import {
  spawnAllActiveBots,
  stopAllBots,
  getBotsStatistics,
  getActiveBots,
} from './services/botManager.js'

// ── 1b. Import handler registration ─────────────────────────────────────────────
import { registerHandlersForAllBots } from './handlers/index.js'

console.log('🚀 Telegram AI Bot — Multi-Tenant Mode (M6)\n')
await spawnAllActiveBots()

// ── 1c. Register handlers untuk semua active bots ────────────────────────────────
const activeBots = getActiveBots()
registerHandlersForAllBots(activeBots)

// ── 1d. Initialize admin bots untuk notifikasi order ─────────────────────────────
import { initAllAdminBots } from './services/adminBot.js'
const activeUserIds = Array.from(activeBots.keys())
if (activeUserIds.length > 0) {
  await initAllAdminBots(activeUserIds)
} else {
  console.warn('⚠️  Tidak ada active users — admin bots tidak diinisialisasi.')
}

// ── 2. Start API server (health, webhook, dashboard API) ──────────────────────
const port = parseInt(process.env.WEBHOOK_PORT || '3000')
const app = createApp()
app.listen(port, () => {
  console.log(`🌐 API server berjalan di http://localhost:${port}`)
  console.log(`   API root: http://localhost:${port}/api`)
  console.log(`   Health check: http://localhost:${port}/api/health`)
  console.log(
    `   Endpoint Midtrans: http://localhost:${port}/api/webhook/midtrans`,
  )
})

// ── 3. Periodic check: monitoring bot status ────────────────────────────────────
setInterval(() => {
  const stats = getBotsStatistics()
  console.log(`📊 Active bots: ${stats.totalActiveBots}`)
}, 60000) // log setiap 1 menit

// ── 4. Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n⏹️  Menghentikan semua bot instances...')
  await stopAllBots()
  process.exit(0)
})

process.on('uncaughtException', (err) => console.error('❌ Uncaught:', err))
process.on('unhandledRejection', (err) => console.error('❌ Unhandled:', err))

console.log('✅ Multi-tenant bot system ready!')
