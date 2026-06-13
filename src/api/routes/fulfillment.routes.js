import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import { createLog, listLogs } from '../controllers/fulfillment.controller.js'

const fulfillmentRouter = Router()

fulfillmentRouter.use(requireAuth)
fulfillmentRouter.post('/:ticketId/log', createLog)
fulfillmentRouter.get('/:ticketId/logs', listLogs)

export default fulfillmentRouter
