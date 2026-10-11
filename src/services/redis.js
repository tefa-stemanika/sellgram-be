import { Redis } from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

let client = null
let wasDisconnected = false

export function getRedisClient() {
  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 5000)
      },
      lazyConnect: true,
    })

    client.on('error', (err) => {
      console.error('[Redis] error:', err.message)
    })

    client.on('reconnecting', () => {
      console.warn('[Redis] reconnecting...')
    })

    client.on('ready', () => {
      if (wasDisconnected) {
        console.log('[Redis] connection restored')
        wasDisconnected = false
      }
    })

    client.on('end', () => {
      wasDisconnected = true
      console.error('[Redis] connection ended')
    })
  }
  return client
}

export async function redisSet(key, value, ttl = null) {
  const c = getRedisClient()
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (ttl) {
    await c.setex(key, ttl, serialized)
  } else {
    await c.set(key, serialized)
  }
}

export async function redisGet(key) {
  const c = getRedisClient()
  const raw = await c.get(key)
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return raw }
}

export async function redisDel(...keys) {
  const c = getRedisClient()
  if (keys.length === 0) return
  await c.del(...keys)
}

export async function redisLpush(key, value) {
  const c = getRedisClient()
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return c.lpush(key, serialized)
}

export async function redisLrange(key, start, stop) {
  const c = getRedisClient()
  const items = await c.lrange(key, start, stop)
  return items.map(item => {
    try { return JSON.parse(item) } catch { return item }
  })
}

export async function redisLtrim(key, start, stop) {
  const c = getRedisClient()
  await c.ltrim(key, start, stop)
}

export async function redisIncr(key) {
  const c = getRedisClient()
  return c.incr(key)
}

export async function redisSetNx(key, value, ttl) {
  const c = getRedisClient()
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const result = await c.set(key, serialized, 'NX', 'EX', ttl)
  return result === 'OK'
}

export async function redisRpop(key) {
  const c = getRedisClient()
  const raw = await c.rpop(key)
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return raw }
}

export async function redisSadd(key, value) {
  const client = getRedisClient()
  if (!client) return 0
  try {
    return await client.sadd(key, value)
  } catch (err) {
    console.error('[Redis] sadd error:', err.message)
    return 0
  }
}

export async function redisSmembers(key) {
  const client = getRedisClient()
  if (!client) return []
  try {
    return await client.smembers(key)
  } catch (err) {
    console.error('[Redis] smembers error:', err.message)
    return []
  }
}

export async function redisSrem(key, value) {
  const client = getRedisClient()
  if (!client) return 0
  try {
    return await client.srem(key, value)
  } catch (err) {
    console.error('[Redis] srem error:', err.message)
    return 0
  }
}

export async function redisExpire(key, ttl) {
  const c = getRedisClient()
  await c.expire(key, ttl)
}

export async function redisKeys(pattern) {
  const c = getRedisClient()
  return c.keys(pattern)
}

export async function redisPing() {
  const c = getRedisClient()
  const result = await c.ping()
  return result === 'PONG'
}

export async function redisQuit() {
  if (client) {
    client.removeAllListeners()
    await client.quit()
    client = null
  }
}

export default { getRedisClient, redisSet, redisGet, redisDel, redisLpush, redisRpop, redisLrange, redisLtrim, redisIncr, redisSetNx, redisExpire, redisKeys, redisPing, redisQuit }
