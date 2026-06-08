import prisma from '../../services/db.js'
import { ok } from '../utils/response.js'

async function getRevenueInRange(userId, start, end) {
  const result = await prisma.order.aggregate({
    where: {
      userId,
      status: 'COMPLETED',
      createdAt: { gte: start, lt: end },
    },
    _sum: { totalPrice: true },
  })
  return result._sum.totalPrice ?? 0
}

export async function getDashboard(req, res, next) {
  try {
    const userId = req.auth.userId

    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const [
      activeProducts,
      totalOrders,
      pendingOrders,
      currentRevenue,
      prevRevenue,
      recentOrders,
      telegramOrders,
      websiteOrders,
      telegramRevenue,
      websiteRevenue,
      totalTickets,
      openTickets,
    ] = await Promise.all([
      prisma.product.count({ where: { userId, isAvailable: true } }),
      prisma.order.count({ where: { userId } }),
      prisma.order.count({
        where: { userId, status: { in: ['PENDING', 'PAYMENT_PENDING'] } },
      }),
      getRevenueInRange(userId, currentMonthStart, now),
      getRevenueInRange(userId, prevMonthStart, currentMonthStart),
      prisma.order.findMany({
        where: { userId },
        select: {
          id: true,
          orderId: true,
          source: true,
          firstName: true,
          username: true,
          customerName: true,
          customerPhone: true,
          status: true,
          totalPrice: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.order.count({ where: { userId, source: 'TELEGRAM' } }),
      prisma.order.count({ where: { userId, source: 'WEBSITE' } }),
      prisma.order.aggregate({
        where: { userId, source: 'TELEGRAM', status: 'COMPLETED' },
        _sum: { totalPrice: true },
      }),
      prisma.order.aggregate({
        where: { userId, source: 'WEBSITE', status: 'COMPLETED' },
        _sum: { totalPrice: true },
      }),
      prisma.ticket.count({ where: { userId } }),
      prisma.ticket.count({
        where: { userId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } },
      }),
    ])

    const revenueGrowth = prevRevenue > 0
      ? ((currentRevenue - prevRevenue) / prevRevenue) * 100
      : currentRevenue > 0 ? 100 : 0

    return ok(res, {
      activeProducts,
      totalOrders,
      pendingOrders,
      totalRevenue: currentRevenue,
      revenueGrowth: Math.round(revenueGrowth * 100) / 100,
      recentOrders,
      ordersBySource: {
        TELEGRAM: telegramOrders,
        WEBSITE: websiteOrders,
      },
      revenueBySource: {
        TELEGRAM: telegramRevenue._sum.totalPrice ?? 0,
        WEBSITE: websiteRevenue._sum.totalPrice ?? 0,
      },
      tickets: {
        total: totalTickets,
        open: openTickets,
        closed: totalTickets - openTickets,
      },
    })
  } catch (error) {
    return next(error)
  }
}
