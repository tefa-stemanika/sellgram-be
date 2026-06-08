import { Router } from 'express'
import rateLimit from '../middlewares/rateLimit.middleware.js'
import {
  getUserProfile,
  listProducts,
  getProduct,
  createOrder,
  getOrderDetail,
  getOrderStatus,
  verifyPayment,
} from '../controllers/public.controller.js'

const router = Router()

router.get('/public/profile/:userId', rateLimit(), getUserProfile)
router.get('/public/products/:userId', rateLimit(), listProducts)
router.get('/public/products/:userId/:productId', rateLimit(), getProduct)
router.post('/public/orders', rateLimit(), createOrder)
router.get('/public/orders/:orderId/detail', rateLimit(), getOrderDetail)
router.get('/public/orders/:orderId', rateLimit(), getOrderStatus)
router.post('/public/orders/:orderId/verify', rateLimit(), verifyPayment)

export default router
