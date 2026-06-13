import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  listFulfillmentLogs,
  getFulfillmentLog,
  retryFulfillment,
} from '../controllers/fulfillmentLog.controller.js'

const fulfillmentLogRouter = Router()

fulfillmentLogRouter.use(requireAuth)
fulfillmentLogRouter.get('/', listFulfillmentLogs)
fulfillmentLogRouter.get('/:id', getFulfillmentLog)
fulfillmentLogRouter.post('/:id/retry', retryFulfillment)

export default fulfillmentLogRouter
