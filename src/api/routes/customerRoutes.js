import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import * as cc from '../controllers/customerController.js'

const router = Router()
router.use(requireAuth)

router.get('/', cc.listCustomers)
router.post('/', cc.createCustomer)
router.get('/:customerId', cc.getCustomer)
router.patch('/:customerId', cc.updateCustomer)
router.delete('/:customerId', cc.deleteCustomer)

export default router
