import { Router } from 'express'
import { getOrderById, getOrders } from '../controllers/orders.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const ordersRouter = Router()

ordersRouter.use(requireAuth)
ordersRouter.get('/orders', getOrders)
ordersRouter.get('/orders/:id', getOrderById)

export default ordersRouter
