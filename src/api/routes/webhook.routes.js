import { Router } from 'express'
import { handleMidtransWebhook } from '../controllers/webhook.controller.js'

const webhookRouter = Router()

webhookRouter.post('/webhook/midtrans', handleMidtransWebhook)

export default webhookRouter
