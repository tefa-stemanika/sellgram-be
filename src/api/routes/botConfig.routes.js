import { Router } from 'express'
import {
  createBotConfig,
  deleteBotConfig,
  getBotConfig,
  updateBotConfig,
} from '../controllers/botConfig.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const botConfigRouter = Router()

botConfigRouter.use(requireAuth)
botConfigRouter.get('/bot-config', getBotConfig)
botConfigRouter.post('/bot-config', createBotConfig)
botConfigRouter.put('/bot-config/:id', updateBotConfig)
botConfigRouter.delete('/bot-config/:id', deleteBotConfig)

export default botConfigRouter
