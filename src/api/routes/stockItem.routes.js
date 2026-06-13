import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  listStockItems,
  createStockItems,
  deleteStockItem,
  countStockItems,
} from '../controllers/stockItem.controller.js'

const stockItemRouter = Router({ mergeParams: true })

stockItemRouter.use(requireAuth)
stockItemRouter.get('/', listStockItems)
stockItemRouter.post('/', createStockItems)
stockItemRouter.get('/count', countStockItems)
stockItemRouter.delete('/:itemId', deleteStockItem)

export default stockItemRouter
