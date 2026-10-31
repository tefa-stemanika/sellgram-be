// tests/whatsapp-lifecycle-tests.js
// Integration test lifecycle instance WhatsApp terhadap mock server Evolution.
// Tidak memanggil Evolution API sungguhan.

import 'dotenv/config'
import http from 'node:http'
import prisma from '../src/services/db.js'
import { redisDel, redisQuit } from '../src/services/redis.js'
import { setCredentialForUser } from '../src/services/configService.js'
import {
  buildTenantInstanceName,
  createWhatsAppInstanceForUser,
  connectWhatsAppForUser,
  restartWhatsAppForUser,
  getWhatsAppStatusForUser,
} from '../src/services/whatsappManager.js'
import { createTestUser, assert, assertEqual } from './test-helpers.js'

const API_KEY = 'test-evolution-key'
const LONG_BASE64 = `data:image/png;base64,${'A'.repeat(120)}`

function createMockEvolutionServer() {
  const instances = new Map()
  const counters = { create: 0, restart: 0, connect: 0, webhookSet: 0 }
  const calls = { createBodies: [], webhookBodies: [] }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock.local')
    const parts = url.pathname.split('/').filter(Boolean)
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.headers.apikey !== API_KEY) {
      return send(401, { message: 'Unauthorized' })
    }

    const [group, action, rawInstance] = parts
    const instanceName = rawInstance ? decodeURIComponent(rawInstance) : null

    if (group === 'instance' && action === 'fetchInstances' && req.method === 'GET') {
      return send(
        200,
        Array.from(instances.values()).map((item) => ({
          name: item.instanceName,
          connectionStatus: item.state,
        })),
      )
    }

    if (group === 'instance' && action === 'create' && req.method === 'POST') {
      const body = await readJson(req)
      calls.createBodies.push(body)
      if (instances.has(body.instanceName)) {
        return send(409, { message: 'Instance already in use' })
      }
      counters.create++
      instances.set(body.instanceName, {
        instanceName: body.instanceName,
        state: 'connecting',
        webhook: null,
      })
      return send(201, {
        instance: { instanceName: body.instanceName, state: 'connecting' },
        qrcode: { code: '2@create', base64: LONG_BASE64, count: 1 },
      })
    }

    if (group === 'instance' && action === 'connectionState' && req.method === 'GET') {
      const item = instances.get(instanceName)
      if (!item) return send(404, { message: 'Instance not found' })
      return send(200, {
        instance: { instanceName, state: item.state },
      })
    }

    if (group === 'instance' && action === 'connect' && req.method === 'GET') {
      const item = instances.get(instanceName)
      if (!item) return send(404, { message: 'Instance not found' })
      counters.connect++
      if (item.state === 'open') {
        return send(200, { instance: { instanceName, state: 'open' } })
      }
      return send(200, {
        pairingCode: null,
        code: '2@connect',
        base64: 'data:image/png;base64,\n',
        count: 3,
      })
    }

    if (group === 'instance' && action === 'restart') {
      const item = instances.get(instanceName)
      if (!item) return send(404, { message: 'Instance not found' })
      if (!['POST', 'PUT'].includes(req.method)) {
        return send(405, { message: 'Method not allowed' })
      }
      counters.restart++
      item.state = 'open'
      return send(200, { instance: { instanceName, state: 'open' } })
    }

    if (group === 'webhook' && action === 'set' && req.method === 'POST') {
      const item = instances.get(instanceName)
      if (!item) return send(404, { message: 'Instance not found' })
      const body = await readJson(req)
      calls.webhookBodies.push(body)
      counters.webhookSet++
      item.webhook = { ...body.webhook, enabled: true }
      return send(200, { webhook: item.webhook })
    }

    if (group === 'webhook' && action === 'find' && req.method === 'GET') {
      const item = instances.get(instanceName)
      if (!item) return send(404, { message: 'Instance not found' })
      if (!item.webhook) {
        return send(404, { message: 'Webhook not found' })
      }
      return send(200, { webhook: item.webhook })
    }

    return send(404, { message: `No mock route for ${req.method} ${url.pathname}` })
  })

  return { server, instances, counters, calls }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function runAsync(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (error) {
    console.error(`❌ ${name}`)
    console.error(`   ${error.message}`)
    process.exitCode = 1
  }
}

const ctx = { createdUserIds: [] }
const mock = createMockEvolutionServer()
const publicBaseUrl = 'https://app.example.com'

try {
  const port = await listen(mock.server)
  const apiUrl = `http://127.0.0.1:${port}`

  const owner = await createTestUser(ctx)
  await setCredentialForUser(owner.user.id, 'EVOLUTION_API_URL', apiUrl)
  await setCredentialForUser(owner.user.id, 'EVOLUTION_API_KEY', API_KEY)

  const tenantInstance = buildTenantInstanceName(owner.user.id)
  const expectedWebhookUrl = `${publicBaseUrl}/api/webhook/whatsapp/${owner.user.id}`

  await runAsync('create instance membuat instance tenant + QR + webhook', async () => {
    const result = await createWhatsAppInstanceForUser(owner.user.id, {
      publicBaseUrl,
    })

    assert(result.success, 'create sukses')
    assert(result.created, 'instance baru dibuat')
    assertEqual(result.instance, tenantInstance, 'nama instance deterministik')
    assertEqual(result.qr?.code, '2@create', 'QR dari create response')
    assertEqual(result.webhook?.success, true, 'webhook terpasang')
    assertEqual(result.webhook?.action, 'created', 'webhook dibuat otomatis')
    assertEqual(
      result.webhook?.webhookUrl,
      expectedWebhookUrl,
      'webhook memakai endpoint userId',
    )
    assertEqual(
      result.instanceLimit,
      1,
      'limit instance per user',
    )
    assertEqual(mock.counters.create, 1, 'POST /instance/create dipanggil sekali')
    assertEqual(
      mock.calls.createBodies[0].instanceName,
      tenantInstance,
      'body create memakai instanceName tenant',
    )
    assertEqual(
      mock.calls.createBodies[0].integration,
      'WHATSAPP-BAILEYS',
      'integrasi Baileys',
    )
    assertEqual(
      mock.calls.createBodies[0].qrcode,
      true,
      'qrcode diminta saat create',
    )
  })

  await runAsync('create instance idempotent', async () => {
    const result = await createWhatsAppInstanceForUser(owner.user.id, {
      publicBaseUrl,
    })

    assert(result.success, 'create kedua sukses')
    assertEqual(result.created, false, 'instance tidak dibuat ulang')
    assertEqual(mock.counters.create, 1, 'tidak ada POST create tambahan')
  })

  await runAsync('instance tidak disimpan sebagai credential EVOLUTION_INSTANCE', async () => {
    const row = await prisma.botCredential.findUnique({
      where: {
        userId_key: {
          userId: owner.user.id,
          key: 'EVOLUTION_INSTANCE',
        },
      },
    })
    assertEqual(row, null, 'instance murni turunan userId, bukan credential')
  })

  await runAsync('status membaca instance tenant dan webhook', async () => {
    const status = await getWhatsAppStatusForUser(owner.user.id, {
      publicBaseUrl,
    })

    assertEqual(status.configured, true, 'configured')
    assertEqual(status.instance, tenantInstance, 'instance tenant')
    assertEqual(status.instanceExists, true, 'instance ada')
    assertEqual(status.needsCreate, false, 'tidak perlu create')
    assertEqual(status.instanceLimit, 1, 'limit instance 1')
    assertEqual(status.state, 'connecting', 'state connecting')
    assertEqual(status.connected, false, 'belum connected')
    assertEqual(status.webhook?.url, expectedWebhookUrl, 'webhook tenant terbaca')
    assertEqual(status.webhook?.expectedUrl, expectedWebhookUrl, 'expectedUrl')
    assertEqual(status.webhook?.synced, true, 'webhook synced')
  })

  await runAsync('connect mengembalikan QR sesuai contoh Evolution', async () => {
    const result = await connectWhatsAppForUser(owner.user.id, {
      publicBaseUrl,
    })

    assert(result.success, 'connect sukses')
    assertEqual(result.code, '2@connect', 'code QR')
    assertEqual(result.pairingCode, null, 'pairingCode null')
    assertEqual(result.base64, null, 'base64 kosong ditolak')
    assertEqual(result.count, 3, 'count')
    assertEqual(result.state, 'connecting', 'state connecting')
    assertEqual(result.connected, false, 'belum connected')
    assertEqual(result.webhook?.success, true, 'webhook tersedia saat connect')
    assertEqual(
      result.webhook?.action,
      'unchanged',
      'webhook tidak di-set ulang bila sudah sesuai',
    )
  })

  await runAsync('connect menolak nomor tidak valid', async () => {
    const result = await connectWhatsAppForUser(owner.user.id, {
      number: '123',
      publicBaseUrl,
    })

    assertEqual(result.success, false, 'connect gagal')
    assertEqual(result.code, 'invalid_number', 'kode invalid_number')
  })

  await runAsync('restart instance + webhook + status open', async () => {
    const result = await restartWhatsAppForUser(owner.user.id, publicBaseUrl)

    assert(result.success, 'restart sukses')
    assertEqual(result.restarted, true, 'instance direstart')
    assertEqual(mock.counters.restart, 1, 'restart dipanggil')
    assertEqual(result.webhookUrl.includes('/api/webhook/whatsapp/'), true, 'webhookUrl')
    assertEqual(result.status.state, 'open', 'state open setelah restart')
    assertEqual(result.status.connected, true, 'connected setelah restart')

    const webhookBody = mock.calls.webhookBodies.at(-1)
    assertEqual(
      webhookBody.webhook.headers['x-evolution-webhook-secret'] !== undefined,
      true,
      'header secret webhook dikirim',
    )
    assertEqual(
      webhookBody.webhook.events.includes('MESSAGES_UPSERT'),
      true,
      'event messages.upsert',
    )
  })

  await runAsync('status tanpa instance → needsCreate true', async () => {
    const stranger = await createTestUser(ctx)
    await setCredentialForUser(stranger.user.id, 'EVOLUTION_API_URL', apiUrl)
    await setCredentialForUser(stranger.user.id, 'EVOLUTION_API_KEY', API_KEY)

    const status = await getWhatsAppStatusForUser(stranger.user.id, {
      publicBaseUrl,
    })

    assertEqual(status.configured, true, 'configured')
    assertEqual(
      status.instance,
      buildTenantInstanceName(stranger.user.id),
      'instance turunan userId',
    )
    assertEqual(status.instanceExists, false, 'instance belum ada')
    assertEqual(status.needsCreate, true, 'perlu create')
    assertEqual(status.instanceLimit, 1, 'limit instance 1')
    assertEqual(status.state, null, 'state kosong')
    assertEqual(status.connected, false, 'belum connected')
  })

  await runAsync('connect pada instance yang belum dibuat → instance_missing', async () => {
    const stranger = await createTestUser(ctx)
    await setCredentialForUser(stranger.user.id, 'EVOLUTION_API_URL', apiUrl)
    await setCredentialForUser(stranger.user.id, 'EVOLUTION_API_KEY', API_KEY)

    const result = await connectWhatsAppForUser(stranger.user.id)

    assertEqual(result.success, false, 'connect gagal')
    assertEqual(result.code, 'instance_missing', 'kode instance_missing')
    assertEqual(
      result.instance,
      buildTenantInstanceName(stranger.user.id),
      'instance turunan userId',
    )
  })
} catch (error) {
  console.error('❌ Test lifecycle gagal di luar runAsync:', error)
  process.exitCode = 1
} finally {
  for (const userId of ctx.createdUserIds) {
    await redisDel(`tenant_config:${userId}`).catch(() => {})
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
  }
  mock.server.close()
  await prisma.$disconnect().catch(() => {})
  await redisQuit().catch(() => {})

  if (process.exitCode) {
    console.error('\n❌ Ada test lifecycle WhatsApp yang gagal.')
  } else {
    console.log('\n✅ Semua test lifecycle WhatsApp lulus.')
  }
}
