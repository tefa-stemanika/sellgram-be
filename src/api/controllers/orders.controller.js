import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import { getAllOrdersForUser } from '../../services/orderService.js'

export async function getOrders(req, res, next) {
  try {
    const { orders, total, page, limit } = await getAllOrdersForUser(req.auth.userId, req.query)
    return okPaginated(res, orders, total, page, limit, 'Get orders success')
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
