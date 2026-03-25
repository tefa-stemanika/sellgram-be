import { Router } from 'express'
import {
  handleMidtransWebhook,
  handleTelegramWebhook,
} from '../controllers/webhook.controller.js'

const webhookRouter = Router()

webhookRouter.post('/webhook/midtrans', handleMidtransWebhook)
webhookRouter.post('/webhook/telegram/:userId', handleTelegramWebhook)

export default webhookRouter
