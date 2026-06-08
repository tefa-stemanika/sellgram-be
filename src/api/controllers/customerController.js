import { ok, okPaginated, fail } from '../utils/response.js'
import * as customerService from '../../services/customerService.js'

export async function listCustomers(req, res, next) {
  try {
    const { customers, total, page, limit } = await customerService.getCustomers(req.auth.userId, req.query)
    return okPaginated(res, customers, total, page, limit)
  } catch (error) {
    return next(error)
  }
}

export async function getCustomer(req, res, next) {
  try {
    const customer = await customerService.getCustomerById(req.params.customerId, req.auth.userId)
    if (!customer) return fail(res, 'Customer not found', 404)
    return ok(res, customer)
  } catch (error) {
    return next(error)
  }
}

export async function createCustomer(req, res, next) {
  try {
    const customer = await customerService.createCustomer(req.auth.userId, req.body)
    return ok(res, customer, 'Customer created', 201)
  } catch (error) {
    if (error.code === 'P2002' || error.message.includes('sudah terdaftar')) {
      return fail(res, error.message, 409)
    }
    return next(error)
  }
}

export async function updateCustomer(req, res, next) {
  try {
    const customer = await customerService.updateCustomer(req.params.customerId, req.auth.userId, req.body)
    return ok(res, customer)
  } catch (error) {
    if (error.message === 'Customer not found') return fail(res, error.message, 404)
    if (error.code === 'P2002' || error.message.includes('sudah terdaftar')) {
      return fail(res, error.message, 409)
    }
    return next(error)
  }
}

export async function deleteCustomer(req, res, next) {
  try {
    await customerService.deleteCustomer(req.params.customerId, req.auth.userId)
    return ok(res, { message: 'Customer deleted' })
  } catch (error) {
    if (error.message === 'Customer not found') return fail(res, error.message, 404)
    return next(error)
  }
}
