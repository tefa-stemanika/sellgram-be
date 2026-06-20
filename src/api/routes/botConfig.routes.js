import { Router } from 'express'
import {
  createBotConfig,
  deleteBotConfig,
  getBotConfig,
  updateBotConfig,
} from '../controllers/botConfig.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'
import { resource as planResource } from '../middlewares/planGuard.js'

const botConfigRouter = Router()

botConfigRouter.use(requireAuth)
botConfigRouter.get('/bot-config', getBotConfig)
botConfigRouter.post('/bot-config', planResource('botConfig'), createBotConfig)
botConfigRouter.put('/bot-config/:id', updateBotConfig)
botConfigRouter.delete('/bot-config/:id', deleteBotConfig)

export default botConfigRouter
