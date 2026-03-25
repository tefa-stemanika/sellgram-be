import { Router } from 'express'
import healthRouter from './health.routes.js'
import webhookRouter from './webhook.routes.js'
import authRouter from './auth.routes.js'
import botConfigRouter from './botConfig.routes.js'
import botCredentialRouter from './botCredential.routes.js'
import ordersRouter from './orders.routes.js'
import productsRouter from './products.routes.js'
import botsRouter from './bots.routes.js'

const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use(webhookRouter)
apiRouter.use(authRouter)
apiRouter.use(botConfigRouter)
apiRouter.use(botCredentialRouter)
apiRouter.use(ordersRouter)
apiRouter.use(productsRouter)
apiRouter.use(botsRouter)

export default apiRouter
