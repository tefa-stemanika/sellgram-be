import { Router } from 'express'
import { requireAuth } from '../middlewares/auth.middleware.js'
import { resource as planResource } from '../middlewares/planGuard.js'
import * as tc from '../controllers/templateController.js'

const router = Router()
router.use(requireAuth)

router.get('/templates', tc.listTemplates)
router.post('/templates', planResource('template'), tc.createTemplate)
router.get('/templates/:id', tc.getTemplate)
router.patch('/templates/:id', tc.updateTemplate)
router.delete('/templates/:id', tc.deleteTemplate)

export default router
