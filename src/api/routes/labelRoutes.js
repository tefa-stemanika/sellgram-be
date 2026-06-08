import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import * as lc from '../controllers/labelController.js'

const router = Router()
router.use(requireAuth)

router.get('/', lc.list)
router.post('/', lc.create)
router.put('/:labelId', lc.update)
router.delete('/:labelId', lc.remove)

export default router
