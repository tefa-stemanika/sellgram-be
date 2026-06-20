import { Worker } from 'bullmq'
import { processSingleRecipient, markBroadcastSent, getBroadcastById } from '../services/broadcastService.js'
import { sendAdminBotMessage } from '../services/adminBot.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = { url: REDIS_URL }

const FAILED_ALERT_THRESHOLD = 0.2

export function createBroadcastWorker() {
  const worker = new Worker('broadcast-jobs', async (job) => {
    const { broadcastId, userId, customerId, channel } = job.data
    const startTime = Date.now()

    console.log(`[BroadcastWorker] Processing: broadcast=${broadcastId}, customer=${customerId}`)

    const result = await processSingleRecipient(broadcastId, userId, customerId, channel)

    const duration = Date.now() - startTime
    if (result.sent > 0 || result.failed > 0) {
      console.log(`[BroadcastWorker] Done: broadcast=${broadcastId}, customer=${customerId}, sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped || false}, duration=${duration}ms`)
    }

    return result
  }, { connection, concurrency: 3 })

  worker.on('completed', async (job) => {
    const { broadcastId, userId } = job.data || {}
    if (!broadcastId) return

    try {
      const broadcast = await getBroadcastById(broadcastId, userId)
      if (!broadcast) return

      if (broadcast.pendingCount === 0 && broadcast.status === 'SENDING') {
        await markBroadcastSent(broadcastId)

        const totalProcessed = broadcast.sentCount + broadcast.failedCount
        const failedRate = totalProcessed > 0 ? broadcast.failedCount / totalProcessed : 0

        console.log(`[BroadcastWorker] Broadcast ${broadcastId} completed. sent=${broadcast.sentCount}, failed=${broadcast.failedCount}, rate=${(failedRate * 100).toFixed(1)}%`)

        if (failedRate > FAILED_ALERT_THRESHOLD) {
          const msg = `⚠️ *Broadcast Alert*\n\nBroadcast \`${broadcast.name}\` selesai dengan tingkat kegagalan tinggi.\n\n📊 ${broadcast.sentCount} terkirim, ${broadcast.failedCount} gagal (${(failedRate * 100).toFixed(0)}%)\n\n🔍 Periksa recipient FAILED untuk detail error.`
          await sendAdminBotMessage(userId, msg)
          console.log(`[BroadcastWorker] Alert sent to admin for broadcast ${broadcastId}: failed rate ${(failedRate * 100).toFixed(1)}%`)
        }
      }
    } catch (err) {
      console.error(`[BroadcastWorker] Gagal check broadcast completion: ${err.message}`)
    }
  })

  worker.on('failed', (job, err) => {
    const { broadcastId } = job?.data || {}
    const errorMsg = err.message || 'Unknown error'

    if (errorMsg.startsWith('TELEGRAM_RATE_LIMITED:')) {
      const retryAfter = parseInt(errorMsg.split(':')[1], 10) || 5
      console.warn(`[BroadcastWorker] Rate limited for broadcast=${broadcastId}, job=${job?.id}. retry_after=${retryAfter}s`)
    } else {
      console.error(`[BroadcastWorker] Job failed: ${job?.id}, broadcast=${broadcastId}, error: ${errorMsg}`)
    }
  })

  return worker
}
