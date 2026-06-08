import { Router } from 'express'
import { authenticateCustomer } from '../middlewares/customerAuth.js'
import * as ctrl from '../controllers/customerAuthController.js'

const router = Router({ mergeParams: true })

router.post('/register', ctrl.register)
router.post('/login', ctrl.login)

router.use(authenticateCustomer)

router.get('/me', ctrl.getProfile)
router.patch('/me', ctrl.updateProfile)
router.patch('/me/password', ctrl.updatePassword)
router.get('/me/orders', ctrl.getOrders)
router.get('/me/orders/:orderId', ctrl.getOrderDetail)

export default router
