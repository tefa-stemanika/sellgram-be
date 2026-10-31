import 'dotenv/config'
import { createApp } from './app.js'
import { getRedisClient, redisQuit } from './services/redis.js'
import { initializeTenantMap } from './services/tenantResolver.js'
import { startWorkers, stopWorkers } from './services/workers.js'
import { createSubscriptionWorker, scheduleSubscriptionJobs } from './workers/subscriptionWorker.js'
import { startBotHealthMonitor, stopBotHealthMonitor } from './services/botHealthService.js'

console.log('🚀 Telegram AI Bot — Multi-Tenant Mode (M6)\n')

getRedisClient()

await initializeTenantMap()

import {
  spawnAllActiveBots,
  stopAllBots,
  getBotsStatistics,
  getActiveBots,
} from './services/botManager.js'

await spawnAllActiveBots()

const activeBots = getActiveBots()

import { initAllAdminBots } from './services/adminBot.js'
const activeUserIds = Array.from(activeBots.keys())
if (activeUserIds.length > 0) {
  await initAllAdminBots(activeUserIds)
} else {
  console.warn('⚠️  Tidak ada active users — admin bots tidak diinisialisasi.')
}

startWorkers()

// Sinkronkan webhook Evolution API untuk WhatsApp (per tenant).
import { initializeWhatsAppWebhooksForActiveUsers } from './services/whatsappManager.js'
await initializeWhatsAppWebhooksForActiveUsers(process.env.PUBLIC_BASE_URL)

// Initialize subscription worker
const subscriptionWorker = createSubscriptionWorker()
await scheduleSubscriptionJobs()

// Initialize broadcast worker
import { createBroadcastWorker } from './workers/broadcastWorker.js'
const broadcastWorker = createBroadcastWorker()

const port = parseInt(process.env.PORT || '3000')
const app = createApp()
const server = app.listen(port, () => {
  console.log(`🌐 API server berjalan di http://localhost:${port}`)
  console.log(`   API root: http://localhost:${port}/api`)
  console.log(`   Health check: http://localhost:${port}/api/health`)
  console.log(
    `   Endpoint Midtrans: http://localhost:${port}/api/webhook/midtrans`,
  )
  console.log(
    `   Endpoint WhatsApp: http://localhost:${port}/api/webhook/whatsapp/:userId`,
  )
})

startBotHealthMonitor()

setInterval(() => {
  const stats = getBotsStatistics()
  console.log(`📊 Active bots: ${stats.totalActiveBots}`)
}, 60000)

async function shutdown(signal) {
  console.log(`\n⏹️  ${signal} diterima — shutdown...`)
  stopBotHealthMonitor()
  server.close()
  await stopWorkers()
  await subscriptionWorker.close()
  if (broadcastWorker) await broadcastWorker.close()
  await stopAllBots()
  await redisQuit()
  const { default: prisma } = await import('./services/db.js')
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('uncaughtException', (err) => console.error('❌ Uncaught:', err))
process.on('unhandledRejection', (err) => console.error('❌ Unhandled:', err))

console.log('✅ Multi-tenant bot system ready!')
