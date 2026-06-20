// src/workers/subscriptionWorker.js
// BullMQ scheduled jobs: expiry check + reminder

import { Queue, Worker } from 'bullmq'
import { getRedisClient } from '../services/redis.js'
import prisma from '../services/db.js'
import { handleExpiredSubscription, updateExpiredStatuses, getOverdueSubscriptions, getSubscriptionsForReminder } from '../services/subscriptionService.js'
import { getBotForUser } from '../services/botManager.js'

const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' }

export const subscriptionQueue = new Queue('subscription-jobs', { connection })

/**
 * Schedule dua job berulang setiap hari jam 08.00 WIB (01.00 UTC)
 */
export async function scheduleSubscriptionJobs() {
  // Hapus job lama agar tidak duplikat saat restart
  await subscriptionQueue.removeRepeatable('check-expiry', { pattern: '0 1 * * *' })
  await subscriptionQueue.removeRepeatable('send-reminders', { pattern: '0 1 * * *' })

  await subscriptionQueue.add(
    'check-expiry',
    {},
    { repeat: { pattern: '0 1 * * *' }, jobId: 'check-expiry' }
  )

  await subscriptionQueue.add(
    'send-reminders',
    {},
    { repeat: { pattern: '0 1 * * *' }, jobId: 'send-reminders' }
  )
}

export function createSubscriptionWorker() {
  const worker = new Worker(
    'subscription-jobs',
    async (job) => {
      if (job.name === 'check-expiry') await runExpiryCheck()
      if (job.name === 'send-reminders') await runReminderSend()
    },
    { connection, concurrency: 1 }
  )

  worker.on('failed', (job, err) => {
    console.error(`[SubscriptionWorker] Job ${job?.id} failed:`, err.message)
  })

  return worker
}

/**
 * Cek subscription yang sudah melewati grace period → downgrade ke FREE.
 * Juga update status ACTIVE yang sudah lewat currentPeriodEnd → EXPIRED.
 */
async function runExpiryCheck() {
  const now = new Date()

  // 1. Update ACTIVE yang sudah lewat currentPeriodEnd tapi masih dalam grace period → EXPIRED
  await updateExpiredStatuses()

  // 2. Handle subscription yang grace period sudah habis → PAST_DUE + downgrade ke FREE
  const overdues = await getOverdueSubscriptions()

  for (const { userId } of overdues) {
    try {
      await handleExpiredSubscription(userId)
      console.log(`[SubscriptionWorker] Handled expiry for user ${userId}`)
    } catch (err) {
      console.error(`[SubscriptionWorker] Gagal handle expiry ${userId}:`, err.message)
    }
  }
}

/**
 * Kirim reminder ke tenant yang subscriptionnya akan expired H-3 dan H-1.
 */
async function runReminderSend() {
  const toRemind = await getSubscriptionsForReminder()

  for (const sub of toRemind) {
    const daysLeft = Math.ceil((sub.currentPeriodEnd - new Date()) / (1000 * 60 * 60 * 24))
    if (daysLeft === 3 || daysLeft === 1) {
      try {
        await sendRenewalReminder(sub, daysLeft)
        console.log(`[SubscriptionWorker] Sent reminder for user ${sub.userId} (${daysLeft} days)`)
      } catch (err) {
        console.error(`[SubscriptionWorker] Gagal kirim reminder ${sub.userId}:`, err.message)
      }
    }
  }
}

async function sendRenewalReminder(sub, daysLeft) {
  // Kirim via admin bot tenant (jika ada ADMIN_BOT_TOKEN dan ADMIN_CHAT_ID)
  const bot = getBotForUser(sub.userId)
  if (!bot) return

  // Cek apakah user punya admin chat ID di credentials
  const adminChatId = await getAdminChatId(sub.userId)
  if (!adminChatId) return

  const msg = `⚠️ *Reminder Subscription*\n\n` +
    `Subscription ${sub.plan} Anda akan berakhir dalam *${daysLeft} hari* ` +
    `(${sub.currentPeriodEnd.toLocaleDateString('id-ID')}).\n\n` +
    `Segera perpanjang agar bot Anda tidak nonaktif.`

  try {
    await bot.sendMessage(adminChatId, msg, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[SubscriptionWorker] Gagal kirim reminder via bot:', err.message)
  }
}

async function getAdminChatId(userId) {
  const { decrypt } = await import('../utils/encryption.js')
  const cred = await prisma.botCredential.findFirst({
    where: { userId, key: 'ADMIN_CHAT_ID' }
  })
  if (!cred?.value) return null
  try {
    return decrypt(cred.value)
  } catch {
    return null
  }
}