// src/api/controllers/invoiceController.js

import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import { getUserInvoices, getInvoiceById } from '../../services/invoiceService.js'

export async function listInvoices(req, res) {
  try {
    const userId = req.auth.userId
    const { page = 1, limit = 20, status } = req.query

    const result = await getUserInvoices(userId, {
      page: Number(page),
      limit: Number(limit),
      status,
    })

    return okPaginated(res, result.invoices, result.total, result.page, result.limit)
  } catch (err) {
    return fail(res, err.message, 500)
  }
}

export async function getInvoice(req, res) {
  try {
    const userId = req.auth.userId
    const { id } = req.params

    const invoice = await getInvoiceById(id, userId)
    if (!invoice) return fail(res, 'Invoice not found', 404)

    return ok(res, invoice)
  } catch (err) {
    return fail(res, err.message, 500)
  }
}