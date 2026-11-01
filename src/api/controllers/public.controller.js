import prisma from '../../services/db.js'
import {
  getAllProducts,
  getProductById,
} from '../../services/productService.js'
import { saveOrder, updateOrderPayment } from '../../services/orderService.js'
import {
  createSnapTransaction,
  checkTransactionStatus,
  isPaymentSuccess,
  isPaymentFailed,
} from '../../services/midtrans.js'
import { settlePayment } from '../../services/paymentSettlement.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import { assertMonthlyOrderLimit } from '../../services/planLimitService.js'

export async function getUserProfile(req, res, next) {
  try {
    const { userId } = req.params
    if (!userId) {
      return fail(res, 'Invalid userId', 400)
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })

    if (!user) {
      return fail(res, 'User not found', 404)
    }

    return ok(res, { name: user.name }, 'Get user profile success')
  } catch (error) {
    return next(error)
  }
}

export async function listProducts(req, res, next) {
  try {
    const { userId } = req.params
    if (!userId) {
      return fail(res, 'Invalid userId', 400)
    }
    const { products, total, page, limit } = await getAllProducts(userId, req.query)
    return okPaginated(res, products, total, page, limit, 'Get products success')
  } catch (error) {
    return next(error)
  }
}

export async function getProduct(req, res, next) {
  try {
    const { userId, productId } = req.params
    if (!userId || !productId) {
      return fail(res, 'Invalid params', 400)
    }
    const product = await getProductById(userId, productId)
    if (!product) {
      return fail(res, 'Product not found', 404)
    }
    return ok(res, product, 'Get product success')
  } catch (error) {
    return next(error)
  }
}

export async function createOrder(req, res, next) {
  try {
    const { userId, productId, quantity, customerName, customerPhone } =
      req.body

    if (!userId || !productId || !quantity || !customerName) {
      return fail(
        res,
        'Missing required fields: userId, productId, quantity, customerName',
        400,
      )
    }

    const qty = parseInt(quantity, 10)
    if (isNaN(qty) || qty < 1 || qty > 99) {
      return fail(res, 'Invalid quantity (1-99)', 400)
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return fail(res, 'User not found', 404)
    }

    const product = await getProductById(userId, productId)
    if (!product) {
      return fail(res, 'Product not found', 404)
    }

    try {
      await assertMonthlyOrderLimit(userId, prisma)
    } catch (err) {
      return fail(res, err.message, 403)
    }

    const savedOrder = await saveOrder({
      userId,
      product,
      quantity: qty,
      source: 'WEBSITE',
      customerName,
      customerPhone,
    })

    const snapResult = await createSnapTransaction({
      userId,
      orderId: savedOrder.orderId,
      totalPrice: savedOrder.totalPrice,
      product,
      quantity: qty,
      customer: { name: customerName, phone: customerPhone },
    })

    await updateOrderPayment(userId, savedOrder.orderId, {
      paymentUrl: snapResult.redirect_url,
      snapToken: snapResult.token,
    })

    return ok(
      res,
      {
        orderId: savedOrder.orderId,
        paymentUrl: snapResult.redirect_url,
        snapToken: snapResult.token,
        totalPrice: savedOrder.totalPrice,
      },
      'Order created successfully',
      201,
    )
  } catch (error) {
    return next(error)
  }
}

export async function getOrderDetail(req, res, next) {
  try {
    const orderId = String(req.params.orderId || '').trim()
    if (!orderId) {
      return fail(res, 'Missing orderId', 400)
    }

    const order = await prisma.order.findFirst({
      where: { orderId },
      include: {
        orderItems: {
          include: {
            product: { select: { id: true, name: true, emoji: true, price: true } },
          },
        },
      },
    })

    if (!order) {
      return fail(res, 'Order not found', 404)
    }

    return ok(res, {
      orderId: order.orderId,
      status: order.status,
      totalPrice: order.totalPrice,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      items: order.orderItems.map((item) => ({
        id: item.product.id,
        name: item.product.name,
        emoji: item.product.emoji,
        price: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.unitPrice * item.quantity,
      })),
    }, 'Get order detail success')
  } catch (error) {
    return next(error)
  }
}

export async function getOrderStatus(req, res, next) {
  try {
    const orderId = String(req.params.orderId || '').trim()
    if (!orderId) {
      return fail(res, 'Missing orderId', 400)
    }

    const order = await prisma.order.findFirst({
      where: { orderId },
      select: {
        orderId: true,
        source: true,
        status: true,
        totalPrice: true,
        paymentUrl: true,
        customerName: true,
        customerPhone: true,
        paidAt: true,
        createdAt: true,
      },
    })

    if (!order) {
      return fail(res, 'Order not found', 404)
    }

    return ok(res, order, 'Get order status success')
  } catch (error) {
    return next(error)
  }
}

export async function verifyPayment(req, res, next) {
  try {
    const orderId = String(req.params.orderId || '').trim()
    if (!orderId) {
      return fail(res, 'Missing orderId', 400)
    }

    // `orderId` hanya unik di dalam satu tenant, jadi endpoint publik ini bisa
    // melihat beberapa order sekaligus. Tiap tenant punya server key sendiri,
    // jadi status transaksi ditanyakan per kandidat dan yang menjawab
    // "berhasil/lunas" yang dipakai.
    const candidates = await prisma.order.findMany({
      where: { orderId },
      select: {
        id: true,
        userId: true,
        orderId: true,
        status: true,
        paidAt: true,
      },
    })

    if (candidates.length === 0) {
      return fail(res, 'Order not found', 404)
    }

    let finalOrder = null
    let failedOrder = null
    let failedNotification = null

    for (const order of candidates) {
      if (order.status === 'COMPLETED' || order.status === 'PAYMENT_FAILED') {
        if (!finalOrder) finalOrder = order
        continue
      }

      let notification = null
      try {
        notification = await checkTransactionStatus(order.userId, orderId)
      } catch {
        // Transaksi tidak ada di akun Midtrans tenant ini (kolisi orderId).
        continue
      }

      if (isPaymentSuccess(notification)) {
        const outcome = await settlePayment({
          orderRowId: order.id,
          fromStatus: order.status,
          guard: { status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED', paidAt: new Date() },
          jobName: 'payment-success',
          jobData: {
            userId: order.userId,
            orderId: order.orderId,
            notification,
          },
        })

        if (outcome.result === 'queue_error') {
          console.error(
            '[Public] Gagal antrekan notifikasi pembayaran:',
            outcome.error.message,
          )
          return fail(res, 'Notification queue unavailable', 500)
        }
        if (outcome.result === 'db_error') {
          return next(outcome.error)
        }

        return ok(res, { status: 'COMPLETED' }, 'Payment verified successfully')
      }

      if (isPaymentFailed(notification) && !failedOrder) {
        failedOrder = order
        failedNotification = notification
      }
    }

    if (failedOrder) {
      const outcome = await settlePayment({
        orderRowId: failedOrder.id,
        fromStatus: failedOrder.status,
        guard: { status: { notIn: ['PAYMENT_FAILED', 'COMPLETED'] } },
        data: { status: 'PAYMENT_FAILED' },
        jobName: 'payment-failed',
        jobData: { userId: failedOrder.userId, orderId: failedOrder.orderId },
      })

      if (outcome.result === 'queue_error') {
        console.error(
          '[Public] Gagal antrekan notifikasi pembayaran:',
          outcome.error.message,
        )
        return fail(res, 'Notification queue unavailable', 500)
      }
      if (outcome.result === 'db_error') {
        return next(outcome.error)
      }

      return ok(res, { status: 'PAYMENT_FAILED' }, 'Payment failed')
    }

    if (finalOrder) {
      return ok(
        res,
        { status: finalOrder.status, paidAt: finalOrder.paidAt },
        finalOrder.status === 'COMPLETED'
          ? 'Payment already completed'
          : 'Payment already failed',
      )
    }

    return ok(res, { status: candidates[0].status }, 'Payment still pending')
  } catch (error) {
    return next(error)
  }
}
