import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import * as ticketService from '../../services/ticketService.js'

export async function listTickets(req, res, next) {
  try {
    const { tickets, total, page, limit } = await ticketService.getTickets(req.auth.userId, req.query)
    return okPaginated(res, tickets, total, page, limit)
  } catch (error) {
    return next(error)
  }
}

export async function listTicketsByStatus(req, res, next) {
  try {
    const { status } = req.params
    const filters = {
      ...req.query,
      status,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    }
    const { tickets, total, page, limit } = await ticketService.getTickets(req.auth.userId, filters)
    return okPaginated(res, tickets, total, page, limit)
  } catch (error) {
    return next(error)
  }
}

export async function getTicket(req, res, next) {
  try {
    const ticket = await ticketService.getTicketById(req.params.ticketId, req.auth.userId)
    if (!ticket) return fail(res, 'Ticket not found', 404)
    return ok(res, ticket)
  } catch (error) {
    return next(error)
  }
}

export async function changeStatus(req, res, next) {
  try {
    const { status } = req.body
    const updated = await ticketService.updateTicketStatus(
      req.params.ticketId,
      req.auth.userId,
      status,
    )
    return ok(res, updated)
  } catch (error) {
    return next(error)
  }
}

export async function changePriority(req, res, next) {
  try {
    const { priority } = req.body
    const updated = await ticketService.updateTicketPriority(
      req.params.ticketId,
      req.auth.userId,
      priority,
    )
    return ok(res, updated)
  } catch (error) {
    return next(error)
  }
}

export async function attachLabel(req, res, next) {
  try {
    await ticketService.addLabel(req.params.ticketId, req.auth.userId, req.body.labelId)
    return ok(res, { message: 'Label attached' })
  } catch (error) {
    return next(error)
  }
}

export async function detachLabel(req, res, next) {
  try {
    await ticketService.removeLabel(req.params.ticketId, req.auth.userId, req.params.labelId)
    return ok(res, { message: 'Label detached' })
  } catch (error) {
    return next(error)
  }
}

export async function postComment(req, res, next) {
  try {
    const { body, isInternal } = req.body
    const comment = await ticketService.addComment(
      req.params.ticketId,
      req.auth.userId,
      body,
      isInternal,
    )
    return ok(res, comment, 201)
  } catch (error) {
    return next(error)
  }
}

export async function editComment(req, res, next) {
  try {
    const comment = await ticketService.updateComment(
      req.params.commentId,
      req.auth.userId,
      req.body.body,
    )
    return ok(res, comment)
  } catch (error) {
    return next(error)
  }
}

export async function removeComment(req, res, next) {
  try {
    await ticketService.deleteComment(req.params.commentId, req.auth.userId)
    return ok(res, { message: 'Comment deleted' })
  } catch (error) {
    return next(error)
  }
}
