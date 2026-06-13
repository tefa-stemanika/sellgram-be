import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import * as fulfillmentService from '../../services/fulfillmentService.js'

export async function createLog(req, res, next) {
  try {
    const { ticketId } = req.params
    const { operation, description, metadata } = req.body

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, userId: req.auth.userId },
    })
    if (!ticket) return fail(res, 'Ticket not found', 404)

    const log = await fulfillmentService.createTicketFulfillmentLog({
      userId: req.auth.userId,
      ticketId,
      operation,
      description,
      metadata,
      performedById: req.auth.userId,
    })

    return ok(res, log, 'Fulfillment log created', 201)
  } catch (error) {
    return next(error)
  }
}

export async function listLogs(req, res, next) {
  try {
    const { ticketId } = req.params
    const { logs, total, page, limit } = await fulfillmentService.getTicketFulfillmentLogs(
      req.auth.userId,
      ticketId,
      req.query,
    )
    return okPaginated(res, logs, total, page, limit)
  } catch (error) {
    return next(error)
  }
}
