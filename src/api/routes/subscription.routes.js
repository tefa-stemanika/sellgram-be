// src/api/routes/subscription.routes.js

import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  getSubscriptionStatus,
  upgradeSubscription,
  cancelSubscriptionHandler,
} from '../controllers/subscriptionController.js'

const router = Router()

router.use(requireAuth)

// Status subscription aktif tenant
router.get('/', getSubscriptionStatus)

// Request upgrade plan → return invoice + paymentUrl
router.post('/upgrade', upgradeSubscription)

// Cancel subscription (akses tetap sampai period end)
router.post('/cancel', cancelSubscriptionHandler)

export default router