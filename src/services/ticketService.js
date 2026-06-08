import prisma from './db.js'
import { logActivity } from './ticketActivityService.js'

export async function createTicketFromOrder(order, userId) {
  const existing = await prisma.ticket.findUnique({
    where: { orderId: order.id },
  })
  if (existing) return existing

  const ticket = await prisma.ticket.create({
    data: {
      userId,
      orderId: order.id,
      title: `Order ${order.orderId}`,
      description: buildOrderDescription(order),
      source: 'ORDER',
      status: 'OPEN',
      customerName: order.customerName ?? null,
      customerContact: order.telegramId ? String(order.telegramId) : (order.customerPhone ?? null),
    },
  })

  await logActivity({
    ticketId: ticket.id,
    userId: null,
    action: 'ticket_created',
    metadata: { source: 'ORDER', orderId: order.orderId },
  })

  return ticket
}

export async function getTickets(userId, filters = {}) {
  const { status, priority, labelId, search, page = 1, limit = 20 } = filters

  const where = {
    userId,
    ...(status && { status }),
    ...(priority && { priority }),
    ...(labelId && { labels: { some: { labelId } } }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { id: { contains: search } },
      ],
    }),
  }

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        labels: { include: { label: true } },
        order: { select: { id: true, totalPrice: true, status: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ])

  return { tickets, total, page, limit, totalPages: Math.ceil(total / limit) }
}

export async function getTicketById(ticketId, userId) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, userId },
    include: {
      labels: { include: { label: true } },
      comments: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      activities: { orderBy: { createdAt: 'asc' } },
      order: true,
    },
  })
}

export async function updateTicketStatus(ticketId, userId, newStatus) {
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, userId } })
  if (!ticket) throw new Error('Ticket not found')

  const oldStatus = ticket.status

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: newStatus,
      ...(newStatus === 'RESOLVED' && { resolvedAt: new Date() }),
      ...(newStatus === 'CLOSED' && { closedAt: new Date() }),
    },
  })

  await logActivity({
    ticketId,
    userId,
    action: 'status_changed',
    metadata: { from: oldStatus, to: newStatus },
  })

  return updated
}

export async function updateTicketPriority(ticketId, userId, priority) {
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, userId } })
  if (!ticket) throw new Error('Ticket not found')

  const oldPriority = ticket.priority

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { priority },
  })

  await logActivity({
    ticketId,
    userId,
    action: 'priority_changed',
    metadata: { from: oldPriority, to: priority },
  })

  return updated
}

export async function addLabel(ticketId, userId, labelId) {
  const label = await prisma.label.findFirst({ where: { id: labelId, userId } })
  if (!label) throw new Error('Label not found')

  await prisma.ticketLabel.upsert({
    where: { ticketId_labelId: { ticketId, labelId } },
    create: { ticketId, labelId },
    update: {},
  })

  await logActivity({
    ticketId,
    userId,
    action: 'label_added',
    metadata: { labelId, labelName: label.name },
  })
}

export async function removeLabel(ticketId, userId, labelId) {
  await prisma.ticketLabel.delete({
    where: { ticketId_labelId: { ticketId, labelId } },
  })

  await logActivity({
    ticketId,
    userId,
    action: 'label_removed',
    metadata: { labelId },
  })
}

export async function addComment(ticketId, userId, body, isInternal = false) {
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, userId } })
  if (!ticket) throw new Error('Ticket not found')

  const comment = await prisma.ticketComment.create({
    data: { ticketId, userId, body, isInternal },
    include: { user: { select: { id: true, name: true } } },
  })

  await logActivity({
    ticketId,
    userId,
    action: 'comment_added',
    metadata: { commentId: comment.id, isInternal },
  })

  return comment
}

export async function updateComment(commentId, userId, body) {
  const comment = await prisma.ticketComment.findFirst({
    where: { id: commentId, userId },
  })
  if (!comment) throw new Error('Comment not found')

  return prisma.ticketComment.update({
    where: { id: commentId },
    data: { body },
  })
}

export async function deleteComment(commentId, userId) {
  const comment = await prisma.ticketComment.findFirst({
    where: { id: commentId, userId },
  })
  if (!comment) throw new Error('Comment not found')

  return prisma.ticketComment.delete({ where: { id: commentId } })
}

function buildOrderDescription(order) {
  const lines = [
    `Order ID: ${order.orderId}`,
    `Source: ${order.source}`,
    `Total: Rp ${order.totalPrice?.toLocaleString('id-ID') ?? '-'}`,
  ]
  if (order.telegramId) lines.push(`Telegram ID: ${order.telegramId}`)
  if (order.customerPhone) lines.push(`Phone: ${order.customerPhone}`)
  return lines.join('\n')
}
