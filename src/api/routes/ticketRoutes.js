import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import * as tc from '../controllers/ticketController.js'

const router = Router()
router.use(requireAuth)

router.get('/', tc.listTickets)
router.get('/status/:status', tc.listTicketsByStatus)
router.get('/:ticketId', tc.getTicket)
router.patch('/:ticketId/status', tc.changeStatus)
router.patch('/:ticketId/priority', tc.changePriority)
router.post('/:ticketId/labels', tc.attachLabel)
router.delete('/:ticketId/labels/:labelId', tc.detachLabel)
router.post('/:ticketId/comments', tc.postComment)
router.put('/:ticketId/comments/:commentId', tc.editComment)
router.delete('/:ticketId/comments/:commentId', tc.removeComment)

export default router
