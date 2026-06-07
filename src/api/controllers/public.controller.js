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
import { notifQueue } from '../../services/queue.js'
import { ok, fail } from '../utils/response.js'

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
    const products = await getAllProducts(userId)
    return ok(res, products, 'Get products success')
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

    const order = await prisma.order.findFirst({
      where: { orderId },
    })

    if (!order) {
      return fail(res, 'Order not found', 404)
    }

    if (order.status === 'COMPLETED') {
      return ok(res, { status: order.status, paidAt: order.paidAt }, 'Payment already completed')
    }

    if (order.status === 'PAYMENT_FAILED') {
      return ok(res, { status: order.status }, 'Payment already failed')
    }

    const notification = await checkTransactionStatus(order.userId, orderId)

    if (isPaymentSuccess(notification)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', paidAt: new Date() },
      })

      await notifQueue.add('payment-success', {
        userId: order.userId,
        orderId: order.orderId,
        notification,
      })

      return ok(res, { status: 'COMPLETED' }, 'Payment verified successfully')
    }

    if (isPaymentFailed(notification)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED' },
      })

      await notifQueue.add('payment-failed', {
        userId: order.userId,
        orderId: order.orderId,
      })

      return ok(res, { status: 'PAYMENT_FAILED' }, 'Payment failed')
    }

    return ok(res, { status: order.status }, 'Payment still pending')
  } catch (error) {
    return next(error)
  }
}
