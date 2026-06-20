// src/api/routes/invoice.routes.js

import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  listInvoices,
  getInvoice,
} from '../controllers/invoiceController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listInvoices)
router.get('/:id', getInvoice)

export default router