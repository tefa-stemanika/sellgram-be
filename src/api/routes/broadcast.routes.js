import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import * as bc from '../controllers/broadcastController.js'

const router = Router()
router.use(requireAuth)

router.get('/broadcasts', bc.listBroadcasts)
router.post('/broadcasts', bc.createBroadcast)
router.post('/broadcasts/preview', bc.previewBroadcast)
router.get('/broadcasts/:id', bc.getBroadcast)
router.patch('/broadcasts/:id', bc.updateBroadcast)
router.delete('/broadcasts/:id', bc.deleteBroadcast)
router.post('/broadcasts/:id/send', bc.startBroadcast)
router.post('/broadcasts/:id/pause', bc.pauseBroadcast)
router.post('/broadcasts/:id/resume', bc.resumeBroadcast)
router.post('/broadcasts/:id/cancel', bc.cancelBroadcast)
router.get('/broadcasts/:id/recipients', bc.listRecipients)

export default router
