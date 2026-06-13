import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  listSlots,
  createSlots,
  deleteSlot,
  releaseSlot,
} from '../controllers/slot.controller.js'

const slotRouter = Router({ mergeParams: true })

slotRouter.use(requireAuth)
slotRouter.get('/', listSlots)
slotRouter.post('/', createSlots)
slotRouter.delete('/:slotId', deleteSlot)
slotRouter.patch('/:slotId/release', releaseSlot)

export default slotRouter
