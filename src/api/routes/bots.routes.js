import { Router } from 'express'
import { getMyBotStatus, getMyBotHealth, reconnectBot, getUserQuota } from '../controllers/botStatus.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const botsRouter = Router()

botsRouter.use(requireAuth)
botsRouter.get('/bots/status', getMyBotStatus)
botsRouter.get('/bots/health', getMyBotHealth)
botsRouter.post('/bots/reconnect', reconnectBot)
botsRouter.get('/bots/quota', getUserQuota)

export default botsRouter
