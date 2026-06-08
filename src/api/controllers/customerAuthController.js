import prisma from '../../services/db.js'
import { ok, fail } from '../utils/response.js'
import * as authService from '../../services/customerAuthService.js'

export async function register(req, res) {
  try {
    const result = await authService.registerCustomer(req.params.userId, req.body)
    return ok(res, result, 201)
  } catch (e) {
    const status = e.message.includes('sudah terdaftar') ? 409 : 400
    return fail(res, e.message, status)
  }
}

export async function login(req, res) {
  try {
    const result = await authService.loginCustomer(req.params.userId, req.body)
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message, 401)
  }
}

export async function getProfile(req, res) {
  try {
    const profile = await authService.getCustomerProfile(req.customer.id, req.tenantId)
    return ok(res, profile)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function updateProfile(req, res) {
  try {
    const updated = await authService.updateCustomerProfile(req.customer.id, req.tenantId, req.body)
    return ok(res, updated)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function updatePassword(req, res) {
  try {
    const result = await authService.changePassword(req.customer.id, req.tenantId, req.body)
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message, 400)
  }
}

export async function getOrders(req, res) {
  try {
    const result = await authService.getCustomerOrders(req.customer.id, req.tenantId, req.query)
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function getOrderDetail(req, res) {
  try {
    const order = await prisma.order.findFirst({
      where: {
        orderId: req.params.orderId,
        customerId: req.customer.id,
        userId: req.tenantId,
      },
      include: {
        orderItems: {
          include: { product: true },
        },
      },
    })
    if (!order) return fail(res, 'Order not found', 404)
    return ok(res, order)
  } catch (e) {
    return fail(res, e.message)
  }
}
