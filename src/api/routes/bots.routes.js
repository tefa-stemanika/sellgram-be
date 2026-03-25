import { Router } from 'express'
import { getMyBotStatus } from '../controllers/botStatus.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const botsRouter = Router()

botsRouter.use(requireAuth)
botsRouter.get('/bots/status', getMyBotStatus)

export default botsRouter
