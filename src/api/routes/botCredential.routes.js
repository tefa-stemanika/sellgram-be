import { Router } from 'express'
import {
  createBotCredential,
  deleteBotCredential,
  getBotCredentials,
  updateBotCredential,
} from '../controllers/botCredential.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const botCredentialRouter = Router()

botCredentialRouter.use(requireAuth)
botCredentialRouter.get('/bot-credentials', getBotCredentials)
botCredentialRouter.post('/bot-credentials', createBotCredential)
botCredentialRouter.put('/bot-credentials/:id', updateBotCredential)
botCredentialRouter.delete('/bot-credentials/:id', deleteBotCredential)

export default botCredentialRouter
