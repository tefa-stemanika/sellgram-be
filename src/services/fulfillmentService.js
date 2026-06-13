import prisma from './db.js'

export async function createTicketFulfillmentLog({ userId, ticketId, operation, description, metadata, performedById }) {
  return prisma.ticketFulfillmentLog.create({
    data: {
      userId,
      ticketId,
      operation,
      description,
      metadata: metadata ?? undefined,
      performedById: performedById ?? undefined,
    },
  })
}

export async function getTicketFulfillmentLogs(userId, ticketId, filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1)
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20))

  const where = {
    userId,
    ticketId,
    ...(filters.operation && { operation: filters.operation }),
  }

  const [logs, total] = await Promise.all([
    prisma.ticketFulfillmentLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticketFulfillmentLog.count({ where }),
  ])

  return { logs, total, page, limit, totalPages: Math.ceil(total / limit) }
}
