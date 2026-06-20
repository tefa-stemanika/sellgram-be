import prisma from './db.js'
import { getBotForUser } from './botManager.js'
import { assertMonthlyBroadcastLimit, incrementMonthlyBroadcastCount, PLAN_LIMITS } from './planLimitService.js'
import { redisSet, redisGet, redisDel, redisSadd, redisSmembers, redisExpire } from './redis.js'

const ALLOWED_SORT = ['createdAt', 'name', 'status', 'totalCustomers', 'sentCount', 'updatedAt']

const ALLOWED_FILTER_KEYS = ['search', 'hasTelegram', 'hasWhatsapp', 'hasEmail', 'totalSpentMin', 'totalSpentMax', 'source']

const PER_BROADCAST_RECIPIENT_LIMITS = {
  FREE: 0,
  STARTER: 1000,
  PRO: Infinity,
}

const PAUSED_KEY_PREFIX = 'broadcast_paused:'
const JOB_IDS_KEY_PREFIX = 'broadcast_job_ids:'

function validateFilters(filters) {
  if (!filters || typeof filters !== 'object') return
  for (const key of Object.keys(filters)) {
    if (!ALLOWED_FILTER_KEYS.includes(key)) {
      throw Object.assign(
        new Error(`Filter key "${key}" tidak dikenal. Allowed keys: ${ALLOWED_FILTER_KEYS.join(', ')}`),
        { statusCode: 400 }
      )
    }
  }
}

function buildCustomerWhere(userId, filters) {
  if (!filters) return { userId }
  const { search, hasTelegram, hasWhatsapp, hasEmail, totalSpentMin, totalSpentMax, source } = filters
  return {
    userId,
    ...(hasTelegram === 'true' ? { hasTelegram: true } : hasTelegram === 'false' ? { hasTelegram: false } : {}),
    ...(hasWhatsapp === 'true' ? { hasWhatsapp: true } : hasWhatsapp === 'false' ? { hasWhatsapp: false } : {}),
    ...(hasEmail === 'true' ? { hasEmail: true } : hasEmail === 'false' ? { hasEmail: false } : {}),
    ...(source ? { source } : {}),
    ...(totalSpentMin !== undefined && totalSpentMin !== '' ? { totalSpent: { gte: Number(totalSpentMin) } } : {}),
    ...(totalSpentMax !== undefined && totalSpentMax !== '' ? { totalSpent: { lte: Number(totalSpentMax) } } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    } : {}),
  }
}

export async function getBroadcasts(userId, filters = {}) {
  const { page = 1, limit = 20, status } = filters
  const where = { userId, ...(status ? { status } : {}) }
  const safeSortBy = ALLOWED_SORT.includes(filters.sortBy) ? filters.sortBy : 'createdAt'
  const safeSortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'

  const [broadcasts, total] = await Promise.all([
    prisma.broadcast.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.broadcast.count({ where }),
  ])

  return { broadcasts, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
}

export async function getBroadcastById(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, userId },
  })
  if (!broadcast) return null

  const [sentCount, failedCount, pendingCount] = await Promise.all([
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'SENT' } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'FAILED' } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'PENDING' } }),
  ])

  const isPaused = await redisGet(`${PAUSED_KEY_PREFIX}${broadcastId}`).catch(() => null)

  return { ...broadcast, sentCount, failedCount, pendingCount, isPaused: isPaused === '1' }
}

export async function createBroadcast(userId, data) {
  const { name, message, channel, filters, scheduledAt } = data
  if (!name || !message) throw Object.assign(new Error('name dan message wajib diisi'), { statusCode: 400 })

  validateFilters(filters)

  const preview = await previewCustomers(userId, filters)
  if (preview.total === 0) throw Object.assign(new Error('Tidak ada customer yang cocok dengan filter'), { statusCode: 400 })

  const hasScheduledAt = scheduledAt && new Date(scheduledAt).getTime() > Date.now()

  const broadcast = await prisma.broadcast.create({
    data: {
      userId,
      name,
      message,
      channel: channel || 'TELEGRAM',
      filters: filters || {},
      totalCustomers: preview.total,
      status: hasScheduledAt ? 'SCHEDULED' : 'DRAFT',
      scheduledAt: hasScheduledAt ? new Date(scheduledAt) : null,
    },
  })

  if (hasScheduledAt) {
    await enqueueBroadcastJobs(broadcast, userId, new Date(scheduledAt))
  }

  return broadcast
}

export async function updateBroadcast(broadcastId, userId, data) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null
  if (broadcast.status !== 'DRAFT' && broadcast.status !== 'SCHEDULED') {
    throw Object.assign(new Error('Hanya broadcast DRAFT atau SCHEDULED yang bisa diedit'), { statusCode: 400 })
  }

  const { name, message, channel, filters, scheduledAt } = data
  if (filters !== undefined) validateFilters(filters)

  const updateData = {}
  if (name !== undefined) updateData.name = name
  if (message !== undefined) updateData.message = message
  if (channel !== undefined) updateData.channel = channel
  if (filters !== undefined) {
    const preview = await previewCustomers(userId, filters)
    updateData.filters = filters
    updateData.totalCustomers = preview.total
  }
  if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt)
    updateData.scheduledAt = d.getTime() > Date.now() ? d : null
  }

  if (broadcast.status === 'SCHEDULED' && (filters !== undefined || name !== undefined || message !== undefined)) {
    await cancelScheduledJobs(broadcastId)
  }

  const updated = await prisma.broadcast.update({ where: { id: broadcastId }, data: updateData })

  if (updated.status === 'SCHEDULED' && updated.scheduledAt) {
    await enqueueBroadcastJobs(updated, userId, updated.scheduledAt)
  }

  return updated
}

export async function deleteBroadcast(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null
  if (broadcast.status !== 'DRAFT' && broadcast.status !== 'SCHEDULED') {
    throw Object.assign(new Error('Hanya broadcast DRAFT atau SCHEDULED yang bisa dihapus'), { statusCode: 400 })
  }
  await cancelScheduledJobs(broadcastId)
  await redisDel(`${PAUSED_KEY_PREFIX}${broadcastId}`).catch(() => {})
  await redisDel(`${JOB_IDS_KEY_PREFIX}${broadcastId}`).catch(() => {})
  await prisma.broadcast.delete({ where: { id: broadcastId } })
  return true
}

async function cancelScheduledJobs(broadcastId) {
  const { broadcastQueue } = await import('./queue.js')
  const jobIdsSetKey = `${JOB_IDS_KEY_PREFIX}${broadcastId}`
  const jobIds = await redisSmembers(jobIdsSetKey).catch(() => [])
  for (const jobId of jobIds) {
    try {
      const job = await broadcastQueue.getJob(jobId)
      if (job) await job.remove()
    } catch {}
  }
  await redisDel(jobIdsSetKey).catch(() => {})
}

export async function previewCustomers(userId, filters) {
  const where = buildCustomerWhere(userId, filters)
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({ where, select: { id: true, name: true, telegramId: true, hasTelegram: true, phone: true, email: true }, take: 20 }),
    prisma.customer.count({ where }),
  ])
  return { customers, total }
}

export async function startBroadcast(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null

  if (broadcast.status === 'SENT') throw Object.assign(new Error('Broadcast sudah selesai dikirim'), { statusCode: 400 })
  if (broadcast.status === 'PAUSED') {
    throw Object.assign(new Error('Broadcast sedang di-pause. Gunakan resume.'), { statusCode: 400 })
  }
  if (broadcast.status === 'FAILED') {
    throw Object.assign(new Error('Broadcast gagal. Buat baru atau cancel.'), { statusCode: 400 })
  }
  if (broadcast.status === 'SENDING') {
    const [sent, failed] = await Promise.all([
      prisma.broadcastRecipient.count({ where: { broadcastId, status: 'SENT' } }),
      prisma.broadcastRecipient.count({ where: { broadcastId, status: 'FAILED' } }),
    ])
    if (sent > 0 || failed > 0) {
      throw Object.assign(new Error('Broadcast sedang berjalan'), { statusCode: 400 })
    }
    await prisma.broadcastRecipient.deleteMany({ where: { broadcastId } }).catch(() => {})
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: 'DRAFT' } }).catch(() => {})
  }

  if (broadcast.status !== 'SCHEDULED') {
    await assertMonthlyBroadcastLimit(userId, prisma)
  }

  if (broadcast.channel === 'TELEGRAM') {
    const bot = getBotForUser(userId)
    if (!bot) throw Object.assign(new Error('Bot Telegram tidak aktif'), { statusCode: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
  const maxRecipients = PER_BROADCAST_RECIPIENT_LIMITS[user?.plan || 'FREE']

  let filters = broadcast.filters || {}
  if (broadcast.channel === 'TELEGRAM' && filters.hasTelegram === undefined) {
    filters = { ...filters, hasTelegram: 'true' }
  }

  const customerWhere = buildCustomerWhere(userId, filters)
  const totalMatching = await prisma.customer.count({ where: customerWhere })
  if (totalMatching === 0) throw Object.assign(new Error('Tidak ada customer yang cocok'), { statusCode: 400 })

  if (totalMatching > maxRecipients) {
    throw Object.assign(
      new Error(`Plan ${user.plan} maksimal ${maxRecipients} penerima per broadcast. ${totalMatching} customer cocok. Persempit filter.`),
      { statusCode: 400 }
    )
  }

  await enqueueBroadcastJobs(broadcast, userId)
  return broadcast
}

async function enqueueBroadcastJobs(broadcast, userId, scheduledAt) {
  let filters = broadcast.filters || {}
  if (broadcast.channel === 'TELEGRAM' && filters.hasTelegram === undefined) {
    filters = { ...filters, hasTelegram: 'true' }
  }

  const customerWhere = buildCustomerWhere(userId, filters)
  const customers = await prisma.customer.findMany({ where: customerWhere, select: { id: true, telegramId: true } })

  if (customers.length === 0) {
    const emptyStatus = scheduledAt ? 'SCHEDULED' : 'SENT'
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: emptyStatus, totalCustomers: 0, ...(emptyStatus === 'SENT' ? { sentAt: new Date() } : {}) },
    })
    return
  }

  await prisma.broadcastRecipient.createMany({
    data: customers.map((c) => ({ broadcastId: broadcast.id, customerId: c.id })),
    skipDuplicates: true,
  })

  const newStatus = scheduledAt ? 'SCHEDULED' : 'SENDING'

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: newStatus,
      totalCustomers: customers.length,
      sentCount: 0,
      failedCount: 0,
      scheduledAt: scheduledAt || null,
    },
  })

  const { broadcastQueue } = await import('./queue.js')
  const jobIdsSetKey = `${JOB_IDS_KEY_PREFIX}${broadcast.id}`
  const delay = scheduledAt ? Math.max(0, new Date(scheduledAt).getTime() - Date.now()) : 0
  let enqueueError = null

  for (const customer of customers) {
    const jobId = `broadcast-${broadcast.id}-recipient-${customer.id}`
    try {
      await broadcastQueue.add(
        'broadcast-send',
        { broadcastId: broadcast.id, userId, customerId: customer.id, channel: broadcast.channel },
        { jobId, delay }
      )
      await redisSadd(jobIdsSetKey, jobId).catch(() => {})
    } catch (err) {
      console.error(`[Broadcast] Gagal enqueue job untuk customer ${customer.id}: ${err.message}`)
      enqueueError = err
    }
  }

  if (enqueueError) {
    await prisma.broadcastRecipient.deleteMany({
      where: { broadcastId: broadcast.id, status: 'PENDING' },
    }).catch(() => {})
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'DRAFT', totalCustomers: 0, sentCount: 0, failedCount: 0 },
    }).catch(() => {})
    await redisDel(jobIdsSetKey).catch(() => {})
    throw Object.assign(
      new Error(`Gagal mengirim broadcast: ${enqueueError.message}`),
      { statusCode: 500 }
    )
  }

  if (delay > 0) {
    await redisExpire(jobIdsSetKey, Math.ceil(delay / 1000) + 86400).catch(() => {})
  }
}

export async function getRecipients(broadcastId, userId, filters = {}) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null

  const { page = 1, limit = 20, status } = filters
  const where = { broadcastId, ...(status ? { status } : {}) }

  const [recipients, total] = await Promise.all([
    prisma.broadcastRecipient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      include: { customer: { select: { id: true, name: true, username: true, telegramId: true, phone: true, email: true } } },
    }),
    prisma.broadcastRecipient.count({ where }),
  ])

  return { recipients, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
}

function parseTelegramError(err) {
  const body = err.body || {}
  const errorMsg = body.description || err.message || 'Unknown error'

  const isBlocked = /blocked|bot was blocked|chat not found|user is deactivated|can't send|user not found/i.test(errorMsg)
  const isTooManyRequests = /429|Too Many Requests|too many requests|retry after/i.test(errorMsg)
  const isTransient = /timeout|timed out|ECONNRESET|ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN|5\d{2}/i.test(errorMsg)

  let retryAfter = 0
  if (isTooManyRequests) {
    retryAfter = body.parameters?.retry_after || 5
    const match = errorMsg.match(/retry.after\s*(\d+)/i)
    if (match) retryAfter = parseInt(match[1], 10)
  }

  return { errorMsg, isBlocked, isTooManyRequests, isTransient, retryAfter: Number(retryAfter) }
}

export async function sendBroadcastMessage(userId, telegramId, message) {
  const bot = getBotForUser(userId)
  if (!bot) return { success: false, error: 'Bot tidak aktif', permanent: true }

  try {
    await bot.sendMessage(Number(telegramId), message, { parse_mode: 'Markdown' })
    return { success: true }
  } catch (err) {
    const parsed = parseTelegramError(err)

    if (parsed.isTooManyRequests && parsed.retryAfter > 0) {
      throw Object.assign(
        new Error(`TELEGRAM_RATE_LIMITED:${parsed.retryAfter}`),
        { code: 'TELEGRAM_RATE_LIMITED', retryAfter: parsed.retryAfter }
      )
    }

    if (parsed.isTransient) {
      throw new Error(`TELEGRAM_TRANSIENT:${parsed.errorMsg}`)
    }

    return { success: false, error: parsed.errorMsg, permanent: parsed.isBlocked }
  }
}

async function ensureBroadcastSending(broadcastId) {
  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SCHEDULED' },
    data: { status: 'SENDING' },
  })
}

export async function processSingleRecipient(broadcastId, userId, customerId, channel) {
  const recipient = await prisma.broadcastRecipient.findFirst({
    where: { broadcastId, customerId },
  })
  if (!recipient) return { sent: 0, failed: 0 }

  if (recipient.status !== 'PENDING') {
    return { sent: recipient.status === 'SENT' ? 1 : 0, failed: recipient.status === 'FAILED' ? 1 : 0 }
  }

  await ensureBroadcastSending(broadcastId)

  const bcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    select: { status: true },
  })
  if (!bcast || bcast.status === 'FAILED' || bcast.status === 'SENT') {
    return { sent: 0, failed: 0 }
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId },
    select: { id: true, telegramId: true, name: true },
  })
  if (!customer) {
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId, customerId },
      data: { status: 'FAILED', error: 'Customer tidak ditemukan' },
    })
    return { sent: 0, failed: 1 }
  }

  const isPaused = await redisGet(`${PAUSED_KEY_PREFIX}${broadcastId}`).catch(() => null)
  if (isPaused === '1') {
    return { sent: 0, failed: 0, skipped: true }
  }

  let recipientStatus, errorMsg
  let shouldDisableTelegram = false

  if (channel === 'TELEGRAM' && customer.telegramId) {
    const msg = await getBroadcastMessage(broadcastId, userId)
    const result = await sendBroadcastMessage(userId, customer.telegramId, msg)
    if (result.success) {
      recipientStatus = 'SENT'
    } else {
      recipientStatus = 'FAILED'
      errorMsg = result.error
      shouldDisableTelegram = result.permanent
    }
  } else {
    recipientStatus = 'FAILED'
    errorMsg = channel === 'TELEGRAM' ? 'Customer tidak memiliki Telegram ID' : `Channel ${channel} belum didukung`
  }

  await prisma.broadcastRecipient.updateMany({
    where: { broadcastId, customerId },
    data: {
      status: recipientStatus,
      error: errorMsg || null,
      sentAt: recipientStatus === 'SENT' ? new Date() : null,
    },
  })

  if (shouldDisableTelegram && recipientStatus === 'FAILED') {
    await prisma.customer.updateMany({
      where: { id: customerId, userId },
      data: { hasTelegram: false },
    }).catch(() => {})
  }

  const sent = recipientStatus === 'SENT' ? 1 : 0
  const failed = recipientStatus === 'FAILED' ? 1 : 0

  if (sent > 0 || failed > 0) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
      },
    }).catch(() => {})
  }

  return { sent, failed }
}

export async function processBroadcastBatch(broadcastId, userId, customerIds, channel) {
  const results = { sent: 0, failed: 0 }
  for (const customerId of customerIds) {
    const r = await processSingleRecipient(broadcastId, userId, customerId, channel)
    results.sent += r.sent
    results.failed += r.failed
  }
  return results
}

async function getBroadcastMessage(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId }, select: { message: true } })
  return broadcast?.message || ''
}

export async function markBroadcastSent(broadcastId) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { userId: true } })
  if (!broadcast) return null
  await incrementMonthlyBroadcastCount(broadcast.userId)
  return prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'SENT', sentAt: new Date() },
  })
}

export async function pauseBroadcast(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null
  if (broadcast.status !== 'SENDING') throw Object.assign(new Error('Hanya broadcast SENDING yang bisa di-pause'), { statusCode: 400 })

  await redisSet(`${PAUSED_KEY_PREFIX}${broadcastId}`, '1')
  return prisma.broadcast.update({ where: { id: broadcastId }, data: { status: 'PAUSED' } })
}

export async function resumeBroadcast(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null
  if (broadcast.status !== 'PAUSED') throw Object.assign(new Error('Hanya broadcast PAUSED yang bisa di-resume'), { statusCode: 400 })

  await redisDel(`${PAUSED_KEY_PREFIX}${broadcastId}`).catch(() => {})

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'SENDING' },
  })

  const pending = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: 'PENDING' },
    select: { customerId: true },
  })

  if (pending.length > 0) {
    const { broadcastQueue } = await import('./queue.js')
    const jobIdsSetKey = `${JOB_IDS_KEY_PREFIX}${broadcastId}`

    for (const { customerId } of pending) {
      const jobId = `broadcast-${broadcastId}-recipient-${customerId}`
      try {
        await broadcastQueue.add(
          'broadcast-send',
          { broadcastId, userId, customerId, channel: broadcast.channel },
          { jobId }
        )
        await redisSadd(jobIdsSetKey, jobId).catch(() => {})
      } catch (err) {
        console.error(`[Broadcast] Gagal enqueue ulang customer ${customerId}: ${err.message}`)
      }
    }
  }

  return broadcast
}

export async function cancelBroadcast(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findFirst({ where: { id: broadcastId, userId } })
  if (!broadcast) return null
  if (broadcast.status === 'SENT') throw Object.assign(new Error('Broadcast sudah selesai'), { statusCode: 400 })

  await cancelScheduledJobs(broadcastId)
  await redisDel(`${PAUSED_KEY_PREFIX}${broadcastId}`).catch(() => {})

  return prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'FAILED' },
  })
}
