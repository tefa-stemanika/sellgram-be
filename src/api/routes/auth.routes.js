import { Router } from 'express'
import {
  getMe,
  login,
  logout,
  register,
} from '../controllers/auth.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const authRouter = Router()

authRouter.post('/auth/register', register)
authRouter.post('/auth/login', login)
authRouter.post('/auth/logout', requireAuth, logout)
authRouter.get('/auth/me', requireAuth, getMe)

export default authRouter
