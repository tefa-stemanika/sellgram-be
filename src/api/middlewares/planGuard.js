// src/api/middlewares/planGuard.js
// Middleware enforcement plan limit di routes

import prisma from '../../services/db.js'
import { redisGet, redisSet, redisDel } from '../../services/redis.js'
import { assertWithinLimit, assertFeatureAllowed, getPlanLimits } from '../../services/planLimitService.js'

const USER_CACHE_TTL = 300
const USER_CACHE_PREFIX = 'user:'

async function getCachedUser(userId) {
  const cacheKey = `${USER_CACHE_PREFIX}${userId}:plan`
  const cached = await redisGet(cacheKey).catch(() => null)
  if (cached) return cached

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true }
  })
  if (!user) return null

  await redisSet(cacheKey, user, USER_CACHE_TTL).catch(() => {})
  return user
}

export async function clearUserCache(userId) {
  await redisDel(`${USER_CACHE_PREFIX}${userId}:plan`).catch(() => {})
}

/**
 * Guard untuk limit resource (botConfig, product).
 * Dipasang di POST routes yang membuat resource baru.
 *
 * Contoh penggunaan:
 * router.post('/bot-config', auth, planGuard.resource('botConfig'), controller)
 */
export const resource = (resourceName) => async (req, res, next) => {
  try {
    await assertWithinLimit(req.auth.userId, resourceName, prisma)
    next()
  } catch (err) {
    if (err.code === 'PLAN_LIMIT_EXCEEDED') {
      return res.status(403).json({
        success: false,
        code: 'PLAN_LIMIT_EXCEEDED',
        message: err.message,
      })
    }
    next(err)
  }
}

/**
 * Guard untuk fitur berbayar (broadcast, fulfillment).
 * Dipasang di route yang membutuhkan fitur tersebut.
 *
 * Contoh penggunaan:
 * router.post('/broadcast', auth, planGuard.feature('canBroadcast'), controller)
 */
export const feature = (featureName) => async (req, res, next) => {
  try {
    const user = await getCachedUser(req.auth.userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    assertFeatureAllowed(user.plan, featureName)
    next()
  } catch (err) {
    if (err.code === 'FEATURE_NOT_ALLOWED') {
      return res.status(403).json({
        success: false,
        code: 'FEATURE_NOT_ALLOWED',
        message: err.message,
      })
    }
    next(err)
  }
}

/**
 * Guard untuk subscription aktif.
 * Jika PAST_DUE → block semua akses API admin kecuali billing.
 * FREE plan selalu boleh akses.
 */
export const requireActiveSubscription = async (req, res, next) => {
  try {
    const user = await getCachedUser(req.auth.userId)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    // FREE plan selalu boleh akses
    if (user.plan === 'FREE') return next()

    const sub = user.subscription
    if (!sub || sub.status === 'PAST_DUE') {
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Subscription Anda telah berakhir. Silakan perpanjang untuk melanjutkan.',
      })
    }

    // EXPIRED tapi masih dalam grace period → izinkan tapi sertakan warning
    if (sub.status === 'EXPIRED') {
      const graceEnd = typeof sub.gracePeriodEnd === 'string' ? sub.gracePeriodEnd : sub.gracePeriodEnd.toISOString()
      res.set('X-Subscription-Warning', `Grace period berakhir ${graceEnd}`)
    }

    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Middleware untuk inject plan limits ke response locals (untuk frontend).
 */
export const injectPlanLimits = async (req, res, next) => {
  try {
    const user = await getCachedUser(req.auth.userId)
    if (user) {
      res.locals.planLimits = getPlanLimits(user.plan)
      res.locals.userPlan = user.plan
    }
    next()
  } catch (err) {
    next(err)
  }
}