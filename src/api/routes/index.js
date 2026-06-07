import { Router } from 'express'
import healthRouter from './health.routes.js'
import authRouter from './auth.routes.js'
import botConfigRouter from './botConfig.routes.js'
import botCredentialRouter from './botCredential.routes.js'
import ordersRouter from './orders.routes.js'
import productsRouter from './products.routes.js'
import botsRouter from './bots.routes.js'
import dashboardRouter from './dashboard.routes.js'

const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use(authRouter)
apiRouter.use(botConfigRouter)
apiRouter.use(botCredentialRouter)
apiRouter.use(ordersRouter)
apiRouter.use(productsRouter)
apiRouter.use(botsRouter)
apiRouter.use(dashboardRouter)

export default apiRouter
