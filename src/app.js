import express from 'express'
import cors from 'cors'
import apiRouter from './api/routes/index.js'
import webhookRouter from './api/routes/webhook.routes.js'
import publicRouter from './api/routes/public.routes.js'
import { requestLogger } from './api/middlewares/requestLogger.middleware.js'
import { notFoundHandler } from './api/middlewares/notFound.middleware.js'
import { errorHandler } from './api/middlewares/error.middleware.js'
import { redisPing } from './services/redis.js'
import prisma from './services/db.js'

export function createApp() {
  const app = express()

  app.use(cors())

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
  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
