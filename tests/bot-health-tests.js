// tests/bot-health-tests.js
// Menguji checkBotHealthForUser / getBotHealthForUser dengan Telegram API ter-stub.

import 'dotenv/config'
import prisma from '../src/services/db.js'
import { redisDel, redisQuit } from '../src/services/redis.js'
import {
  checkBotHealthForUser,
  getBotHealthForUser,
} from '../src/services/botHealthService.js'
import { spawnBotForUser, stopBotForUser } from '../src/services/botManager.js'
import { TestContext, createTestUser, assert, assertEqual } from './test-helpers.js'

const realFetch = globalThis.fetch
const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL
const BASE_URL = 'https://example.test'

let fetchCalls = []
let handlers = {}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetchMock() {
  globalThis.fetch = async (url, options) => {
    const text = String(url)
    fetchCalls.push(text)
    const method = text.split('/').pop().split('?')[0]
    const handler = handlers[method]
    if (!handler) {
      throw new Error(`Unexpected fetch call: ${method}`)
    }
    return handler(text, options)
  }
}

function resetFetchCalls() {
  fetchCalls = []
}

const getMeCalls = () => fetchCalls.filter((url) => url.endsWith('/getMe')).length
const webhookInfoCalls = () =>
  fetchCalls.filter((url) => url.endsWith('/getWebhookInfo')).length

function hasIssue(result, code) {
  return result.issues.some((issue) => issue.code === code)
}

const ctx = new TestContext()
const cacheKeys = []

async function runScenarios() {
  process.env.PUBLIC_BASE_URL = BASE_URL
  installFetchMock()

  // 1. Token ditolak Telegram -> unhealthy, webhook tidak dicek
  console.log('\n🧪 Invalid token returns unhealthy without webhook check')
  {
    const { user } = await createTestUser(ctx)
    cacheKeys.push(`bot_health:${user.id}`)
    resetFetchCalls()
    handlers = {
      getMe: async () => jsonResponse(401, { ok: false, description: 'Unauthorized' }),
      getWebhookInfo: async () => {
        throw new Error('getWebhookInfo should not be called')
      },
    }

    const result = await checkBotHealthForUser(user.id, { baseUrl: BASE_URL })

    assertEqual(result.status, 'unhealthy', 'status is unhealthy')
    assertEqual(result.checks.token.status, 'invalid', 'token check is invalid')
    assert(hasIssue(result, 'TOKEN_INVALID'), 'TOKEN_INVALID issue present')
    assertEqual(webhookInfoCalls(), 0, 'getWebhookInfo not called')
  }

  // 2. Token valid + webhook terdaftar benar + runtime aktif -> healthy
  console.log('\n🧪 Healthy bot with correct webhook')
  {
    const { user } = await createTestUser(ctx)
    cacheKeys.push(`bot_health:${user.id}`)
    const expectedUrl = `${BASE_URL}/api/webhook/telegram/${user.id}`
    handlers = {
      getMe: async () =>
        jsonResponse(200, {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: 'Test Bot',
            username: 'test_bot',
          },
        }),
      getWebhookInfo: async () =>
        jsonResponse(200, {
          ok: true,
          result: { url: expectedUrl, pending_update_count: 0 },
        }),
    }

    const spawned = await spawnBotForUser(user.id)
    assert(spawned?.bot, 'bot spawned with stubbed Telegram API')

    resetFetchCalls()
    const result = await checkBotHealthForUser(user.id, { baseUrl: BASE_URL })

    assertEqual(result.status, 'healthy', 'status is healthy')
    assertEqual(result.checks.token.username, 'test_bot', 'bot username populated')
    assertEqual(result.checks.webhook.status, 'ok', 'webhook check is ok')
    assertEqual(result.checks.runtime.active, true, 'runtime active')
    assertEqual(result.issues.length, 0, 'no issues')

    // 5. Cache: panggilan kedua tanpa refresh memakai cache
    console.log('\n🧪 Health result is cached and refresh bypasses cache')
    resetFetchCalls()
    const cached = await getBotHealthForUser(user.id, { baseUrl: BASE_URL })
    assertEqual(cached.cached, true, 'second call served from cache')
    assertEqual(getMeCalls() + webhookInfoCalls(), 0, 'no Telegram calls on cache hit')

    const refreshed = await getBotHealthForUser(user.id, {
      refresh: true,
      baseUrl: BASE_URL,
    })
    assertEqual(refreshed.cached, false, 'refresh bypasses cache')
    assertEqual(getMeCalls(), 1, 'getMe called once on refresh')
    assertEqual(webhookInfoCalls(), 1, 'getWebhookInfo called once on refresh')

    await stopBotForUser(user.id)
  }

  // 3. Webhook belum terdaftar -> unhealthy
  console.log('\n🧪 Missing webhook returns unhealthy')
  {
    const { user } = await createTestUser(ctx)
    cacheKeys.push(`bot_health:${user.id}`)
    handlers = {
      getMe: async () =>
        jsonResponse(200, {
          ok: true,
          result: { id: 1, is_bot: true, first_name: 'X', username: 'x_bot' },
        }),
      getWebhookInfo: async () =>
        jsonResponse(200, {
          ok: true,
          result: { url: '', pending_update_count: 0 },
        }),
    }

    const result = await checkBotHealthForUser(user.id, { baseUrl: BASE_URL })

    assertEqual(result.status, 'unhealthy', 'status is unhealthy')
    assertEqual(result.checks.webhook.status, 'missing', 'webhook check is missing')
    assert(hasIssue(result, 'WEBHOOK_URL_MISSING'), 'WEBHOOK_URL_MISSING issue present')
  }

  // 4. Backlog + error pengiriman baru -> degraded
  console.log('\n🧪 Webhook backlog and recent error return degraded')
  {
    const { user } = await createTestUser(ctx)
    cacheKeys.push(`bot_health:${user.id}`)
    const expectedUrl = `${BASE_URL}/api/webhook/telegram/${user.id}`
    handlers = {
      getMe: async () =>
        jsonResponse(200, {
          ok: true,
          result: { id: 2, is_bot: true, first_name: 'Y', username: 'y_bot' },
        }),
      getWebhookInfo: async () =>
        jsonResponse(200, {
          ok: true,
          result: {
            url: expectedUrl,
            pending_update_count: 51,
            last_error_date: Math.floor(Date.now() / 1000) - 60,
            last_error_message: 'Wrong response from the webhook: 500',
          },
        }),
    }

    const result = await checkBotHealthForUser(user.id, { baseUrl: BASE_URL })

    assertEqual(result.status, 'degraded', 'status is degraded')
    assert(
      hasIssue(result, 'WEBHOOK_PENDING_BACKLOG'),
      'WEBHOOK_PENDING_BACKLOG issue present',
    )
    assert(
      hasIssue(result, 'WEBHOOK_LAST_ERROR_RECENT'),
      'WEBHOOK_LAST_ERROR_RECENT issue present',
    )
    assert(hasIssue(result, 'BOT_NOT_SPAWNED'), 'BOT_NOT_SPAWNED issue present')
  }

  return true
}

let success = true

try {
  success = await runScenarios()
} catch (err) {
  console.error('\n❌ Test suite failed:', err.message)
  success = false
} finally {
  if (cacheKeys.length > 0) {
    await redisDel(...cacheKeys).catch(() => {})
  }
  globalThis.fetch = realFetch
  if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl

  await ctx.cleanup()
  await redisQuit()
  await prisma.$disconnect()
}

console.log(success ? '\n✅ All bot health tests passed' : '\n❌ Bot health tests failed')
process.exit(success ? 0 : 1)
