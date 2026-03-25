import prisma from '../../services/db.js'
import { ok, fail } from '../utils/response.js'

export async function getOrders(req, res, next) {
  try {
    const userId = req.auth.userId
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const status = req.query.status

    const where = {
      userId,
      ...(status ? { status: String(status) } : {}),
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return ok(res, orders, 'Get orders success')
  } catch (error) {
    return next(error)
  }
}

export async function getOrderById(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid order id', 400)
    }

    const order = await prisma.order.findFirst({
      where: { id, userId },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
      },
    })

    if (!order) {
      return fail(res, 'Order tidak ditemukan', 404)
    }

    return ok(res, order, 'Get order success')
  } catch (error) {
    return next(error)
  }
}
