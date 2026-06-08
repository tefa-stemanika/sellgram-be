import prisma from './db.js'

export async function logActivity({ ticketId, userId, action, metadata }) {
  return prisma.ticketActivity.create({
    data: { ticketId, userId: userId ?? null, action, metadata: metadata ?? {} },
  })
}

export async function getActivities(ticketId) {
  return prisma.ticketActivity.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'asc' },
  })
}
