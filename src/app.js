import express from 'express'
import cors from 'cors'
import apiRouter from './api/routes/index.js'
import webhookRouter from './api/routes/webhook.routes.js'
import publicRouter from './api/routes/public.routes.js'
import ticketRouter from './api/routes/ticketRoutes.js'
import labelRouter from './api/routes/labelRoutes.js'
import customerRouter from './api/routes/customerRoutes.js'
import customerPortalRoutes from './api/routes/customerPortalRoutes.js'
import dummySupplierRouter from './api/routes/dummySupplier.routes.js'
import subscriptionRoutes from './api/routes/subscription.routes.js'
import invoiceRoutes from './api/routes/invoice.routes.js'
import { requestLogger } from './api/middlewares/requestLogger.middleware.js'
import { notFoundHandler } from './api/middlewares/notFound.middleware.js'
import { errorHandler } from './api/middlewares/error.middleware.js'
import { requireAuth } from './api/middlewares/auth.middleware.js'
import { requireActiveSubscription } from './api/middlewares/planGuard.js'
import authRoutes from './api/routes/auth.routes.js'
import { redisPing } from './services/redis.js'
import prisma from './services/db.js'

export function createApp() {
  const app = express()

  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  }))

  app.use(express.json({ limit: '1mb' }))
  app.use(requestLogger)

  app.get('/health', async (req, res) => {
    const checks = { status: 'ok' }
    try {
      checks.redis = await redisPing() ? 'ok' : 'error'
    } catch {
      checks.redis = 'error'
    }
    try {
      await prisma.$queryRaw`SELECT 1`
      checks.db = 'ok'
    } catch {
      checks.db = 'error'
    }
    const healthy = checks.redis === 'ok' && checks.db === 'ok'
    res.status(healthy ? 200 : 503).json(checks)
  })

  app.use('/api', webhookRouter)
  app.use('/api', publicRouter)
  app.use('/api/tickets', ticketRouter)
  app.use('/api/labels', labelRouter)
  app.use('/api/customers', customerRouter)
  app.use('/api/portal/:userId', customerPortalRoutes)
  app.use('/api/dummy', dummySupplierRouter)

  // Billing routes — HARUS sebelum requireActiveSubscription agar tenant PAST_DUE tetap bisa bayar
  app.use('/api/subscription', requireAuth, subscriptionRoutes)
  app.use('/api/invoices', requireAuth, invoiceRoutes)

  // Auth routes — HARUS sebelum global requireAuth agar login/register publik
  app.use('/api', authRoutes)

  // Global subscription guard untuk semua API admin lainnya
  app.use('/api', requireAuth, requireActiveSubscription)

  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
