import { Router } from 'express'
import healthRouter from './health.routes.js'
import authRouter from './auth.routes.js'
import botConfigRouter from './botConfig.routes.js'
import botCredentialRouter from './botCredential.routes.js'
import ordersRouter from './orders.routes.js'
import productsRouter from './products.routes.js'
import botsRouter from './bots.routes.js'
import dashboardRouter from './dashboard.routes.js'
import fulfillmentRouter from './fulfillment.routes.js'
import fulfillmentConfigRouter from './fulfillmentConfig.routes.js'
import stockItemRouter from './stockItem.routes.js'
import slotAccountRouter from './slotAccount.routes.js'
import slotRouter from './slot.routes.js'
import fulfillmentLogRouter from './fulfillmentLog.routes.js'
import broadcastRouter from './broadcast.routes.js'
import templateRouter from './template.routes.js'

const apiRouter = Router()

apiRouter.use(healthRouter)
apiRouter.use(authRouter)
apiRouter.use(botConfigRouter)
apiRouter.use(botCredentialRouter)
apiRouter.use(ordersRouter)
apiRouter.use(productsRouter)
apiRouter.use(botsRouter)
apiRouter.use(dashboardRouter)
apiRouter.use('/fulfillment', fulfillmentRouter)
apiRouter.use('/products/:productId/fulfillment', fulfillmentConfigRouter)
apiRouter.use('/products/:productId/stock-items', stockItemRouter)
apiRouter.use('/products/:productId/slot-accounts', slotAccountRouter)
apiRouter.use('/products/:productId/slot-accounts/:accountId/slots', slotRouter)
apiRouter.use('/fulfillment-logs', fulfillmentLogRouter)
apiRouter.use(broadcastRouter)
apiRouter.use(templateRouter)

export default apiRouter
