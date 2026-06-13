import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import {
  listSlotAccounts,
  createSlotAccount,
  updateSlotAccount,
  deleteSlotAccount,
} from '../controllers/slot.controller.js'

const slotAccountRouter = Router({ mergeParams: true })

slotAccountRouter.use(requireAuth)
slotAccountRouter.get('/', listSlotAccounts)
slotAccountRouter.post('/', createSlotAccount)
slotAccountRouter.put('/:accountId', updateSlotAccount)
slotAccountRouter.delete('/:accountId', deleteSlotAccount)

export default slotAccountRouter
