import { redisSet, redisGet, redisExpire } from '../../services/redis.js'

const DEFAULT_MAX_REQUESTS = 30
const DEFAULT_WINDOW_SECONDS = 60

export function rateLimit(maxRequests = DEFAULT_MAX_REQUESTS, windowSeconds = DEFAULT_WINDOW_SECONDS) {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown'
      const key = `ratelimit:${ip}`
      const now = Date.now()

      const record = await redisGet(key)
      if (record) {
        const windowStart = record.windowStart
        const count = record.count

        if (now - windowStart < windowSeconds * 1000) {
          if (count >= maxRequests) {
            res.set('Retry-After', Math.ceil((windowStart + windowSeconds * 1000 - now) / 1000).toString())
            return res.status(429).json({ error: 'Too many requests. Please try again later.' })
          }
          await redisSet(key, { windowStart, count: count + 1 }, windowSeconds)
        } else {
          await redisSet(key, { windowStart: now, count: 1 }, windowSeconds)
        }
      } else {
        await redisSet(key, { windowStart: now, count: 1 }, windowSeconds)
      }

      next()
    } catch (err) {
      console.error('[RateLimit] error:', err.message)
      next()
    }
  }
}

export default rateLimit
