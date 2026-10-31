import { Router } from 'express'
import {
  handleMidtransWebhook,
  handleTelegramWebhook,
  handleWhatsAppWebhook,
} from '../controllers/webhook.controller.js'

const webhookRouter = Router()

webhookRouter.post('/webhook/midtrans', handleMidtransWebhook)
webhookRouter.post('/webhook/telegram/:userId', handleTelegramWebhook)
webhookRouter.post('/webhook/whatsapp/:userId', handleWhatsAppWebhook)

export default webhookRouter
