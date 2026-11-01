import { Router } from 'express'
import {
  getMyBotStatus,
  getMyBotHealth,
  reconnectBot,
  getMyWhatsAppStatus,
  reconnectWhatsApp,
  createMyWhatsAppInstance,
  connectMyWhatsApp,
  restartWhatsApp,
  getUserQuota,
} from '../controllers/botStatus.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const botsRouter = Router()

botsRouter.use(requireAuth)
botsRouter.get('/bots/status', getMyBotStatus)
botsRouter.get('/bots/health', getMyBotHealth)
botsRouter.post('/bots/reconnect', reconnectBot)
botsRouter.get('/bots/whatsapp/status', getMyWhatsAppStatus)
botsRouter.post('/bots/whatsapp/instance', createMyWhatsAppInstance)
botsRouter.get('/bots/whatsapp/connect', connectMyWhatsApp)
botsRouter.post('/bots/whatsapp/restart', restartWhatsApp)
botsRouter.post('/bots/whatsapp/reconnect', reconnectWhatsApp)
botsRouter.get('/bots/quota', getUserQuota)

export default botsRouter
