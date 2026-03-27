import express from 'express'
import cors from 'cors'
import apiRouter from './api/routes/index.js'
import webhookRouter from './api/routes/webhook.routes.js'
import { requestLogger } from './api/middlewares/requestLogger.middleware.js'
import { notFoundHandler } from './api/middlewares/notFound.middleware.js'
import { errorHandler } from './api/middlewares/error.middleware.js'

export function createApp() {
  const app = express()

  // Enable CORS globally so dashboard frontend can access from any origin.
  app.use(cors())


  app.use(express.json({ limit: '1mb' }))
  app.use(requestLogger)

  // Pasang webhookRouter lebih awal, agar tidak terkena middleware lain
  app.use('/api', webhookRouter)

  // Router lain (bisa saja ada middleware autentikasi di dalamnya)
  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
