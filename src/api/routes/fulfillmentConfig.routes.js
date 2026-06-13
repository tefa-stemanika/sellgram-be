import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  getFulfillmentConfig,
  upsertFulfillmentConfig,
  deleteFulfillmentConfig,
} from '../controllers/fulfillmentConfig.controller.js'

const fulfillmentConfigRouter = Router({ mergeParams: true })

fulfillmentConfigRouter.use(requireAuth)
fulfillmentConfigRouter.get('/', getFulfillmentConfig)
fulfillmentConfigRouter.post('/', upsertFulfillmentConfig)
fulfillmentConfigRouter.delete('/', deleteFulfillmentConfig)

export default fulfillmentConfigRouter
