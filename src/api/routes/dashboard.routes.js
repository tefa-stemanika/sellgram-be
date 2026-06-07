import { Router } from 'express'
import { getDashboard } from '../controllers/dashboard.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const dashboardRouter = Router()

dashboardRouter.use(requireAuth)
dashboardRouter.get('/dashboard', getDashboard)

export default dashboardRouter
