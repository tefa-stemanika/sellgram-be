import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import { fulfillmentQueue } from '../../services/queue.js'

export async function listFulfillmentLogs(req, res) {
  const userId = req.auth.userId
  const { status, page = 1, limit = 50 } = req.query

  const where = { userId }
  if (status) where.status = status

  const [logs, total] = await Promise.all([
    prisma.fulfillmentLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
      include: {
        order: { select: { orderId: true, totalPrice: true } },
      },
    }),
    prisma.fulfillmentLog.count({ where }),
  ])

  return okPaginated(res, logs, total, Number(page), Number(limit))
}

export async function getFulfillmentLog(req, res) {
  const { id } = req.params
  const userId = req.auth.userId

  const log = await prisma.fulfillmentLog.findFirst({
    where: { id, userId },
  })
  if (!log) return fail(res, 'Log not found', 404)

  return ok(res, log)
}

export async function retryFulfillment(req, res) {
  const { id } = req.params
  const userId = req.auth.userId

  const log = await prisma.fulfillmentLog.findFirst({
    where: { id, userId, status: 'FAILED' },
  })
  if (!log) return fail(res, 'Failed log not found', 404)

  await fulfillmentQueue.add('fulfill', {
    orderId: log.orderId,
    userId,
    productId: log.productId,
  })

  return ok(res, { retried: true })
}
