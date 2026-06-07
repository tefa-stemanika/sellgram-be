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
          firstName: true,
          username: true,
          status: true,
          totalPrice: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    let percentage = 0
    let trend = 'stable'
    if (prevRevenue > 0) {
      percentage = parseFloat(
        (((currentRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1),
      )
      trend = percentage > 1 ? 'up' : percentage < -1 ? 'down' : 'stable'
    } else if (currentRevenue > 0) {
      trend = 'up'
    }

    return ok(res, {
      activeProducts,
      totalOrders,
      pendingOrders,
      totalRevenue: currentRevenue,
      revenueChange: { percentage, trend },
      recentOrders,
    })
  } catch (error) {
    return next(error)
  }
}
