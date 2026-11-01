// tests/whatsapp-lifecycle-tests.js
// Integration test lifecycle instance WhatsApp terhadap mock server Evolution.
// Tidak memanggil Evolution API sungguhan.

import 'dotenv/config'
import http from 'node:http'
import prisma from '../src/services/db.js'
import {
  getRedisClient,
  redisDel,
  redisExpire,
  redisGet,
  redisLpush,
  redisQuit,
  redisReleaseLock,
  redisRpop,
  redisSet,
  redisSetNx,
} from '../src/services/redis.js'
import { setCredentialForUser } from '../src/services/configService.js'
import { upsertCustomerFromOrder } from '../src/services/customerService.js'
import { createTicketFromOrder } from '../src/services/ticketService.js'
import {
  buildTenantInstanceName,
  createWhatsAppInstanceForUser,
  connectWhatsAppForUser,
  migrateChatState,
  restartWhatsAppForUser,
  getWhatsAppStatusForUser,
} from '../src/services/whatsappManager.js'
import {
  TestContext,
  createTestOrder,
  createTestProducts,
  createTestUser,
  assert,
  assertEqual,
} from './test-helpers.js'

const API_KEY = 'test-evolution-key'
const LONG_BASE64 = `data:image/png;base64,${'A'.repeat(120)}`

function createMockEvolutionServer() {
  const instances = new Map()
  const counters = { create: 0, restart: 0, connect: 0, webhookSet: 0 }
  const calls = { createBodies: [], webhookBodies: [] }
  const restartFail = new Set()
  const state = { duplicateNames: false }

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
      const list = Array.from(instances.values()).map((item) => ({
        name: item.instanceName,
        connectionStatus: item.state,
      }))
      // Simulasi server yang mengembalikan entri ganda untuk nama yang sama.
      return send(200, state.duplicateNames ? [...list, ...list] : list)
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
      if (restartFail.has(instanceName)) {
        return send(500, { message: 'Restart rejected by Evolution' })
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

  return { server, instances, counters, calls, restartFail, state }
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

const ctx = new TestContext()
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

  await runAsync('restart gagal → success false + code restart_failed', async () => {
    const victim = await createTestUser(ctx)
    await setCredentialForUser(victim.user.id, 'EVOLUTION_API_URL', apiUrl)
    await setCredentialForUser(victim.user.id, 'EVOLUTION_API_KEY', API_KEY)

    const created = await createWhatsAppInstanceForUser(victim.user.id, {
      publicBaseUrl,
    })
    assert(created.success, 'instance korban dibuat')

    mock.restartFail.add(buildTenantInstanceName(victim.user.id))

    const result = await restartWhatsAppForUser(victim.user.id, publicBaseUrl)

    assertEqual(result.success, false, 'restart gagal dilaporkan gagal')
    assertEqual(result.code, 'restart_failed', 'kode restart_failed')
    assertEqual(result.restarted, false, 'restarted false')
    assert(String(result.reason).includes('Restart rejected'), 'alasan dari Evolution')
    assertEqual(result.webhook.success, true, 'webhook tetap tersinkron')
  })

  await runAsync('fetchInstances duplikat → instance_limit_reached', async () => {
    const dup = await createTestUser(ctx)
    await setCredentialForUser(dup.user.id, 'EVOLUTION_API_URL', apiUrl)
    await setCredentialForUser(dup.user.id, 'EVOLUTION_API_KEY', API_KEY)

    const created = await createWhatsAppInstanceForUser(dup.user.id, {
      publicBaseUrl,
    })
    assert(created.success, 'instance dibuat sebelum duplikasi disimulasikan')

    mock.state.duplicateNames = true
    try {
      const result = await createWhatsAppInstanceForUser(dup.user.id, {
        publicBaseUrl,
      })

      assertEqual(result.success, false, 'create ditolak')
      assertEqual(result.code, 'instance_limit_reached', 'kode instance_limit_reached')
      assertEqual(result.instanceLimit, 1, 'limit 1')
    } finally {
      mock.state.duplicateNames = false
    }
  })

  await runAsync('API key salah → status error, bukan dianggap instance hilang', async () => {
    const wrongKey = await createTestUser(ctx)
    await setCredentialForUser(wrongKey.user.id, 'EVOLUTION_API_URL', apiUrl)
    await setCredentialForUser(wrongKey.user.id, 'EVOLUTION_API_KEY', 'bukan-key-benar')

    const status = await getWhatsAppStatusForUser(wrongKey.user.id, { publicBaseUrl })

    assertEqual(status.configured, true, 'konfigurasi ada')
    assertEqual(status.instanceExists, null, '401 bukan berarti instance tidak ada')
    assert(
      status.errors.some((e) => String(e).includes('401')),
      'error 401 tercatat di status.errors',
    )
  })

  await runAsync('redis lock memakai fencing token', async () => {
    const token = 'token-a'
    const key = `test_lock:${owner.user.id}`

    assert(await redisSetNx(key, token, 30), 'lock didapat')
    assertEqual(await redisSetNx(key, 'token-b', 30), false, 'lock tidak bisa direbut')
    assertEqual(await redisReleaseLock(key, 'token-b'), false, 'pelepasan salah token ditolak')
    assertEqual(await redisGet(key), token, 'lock masih dipegang token awal')
    assertEqual(await redisReleaseLock(key, token), true, 'pemegang melepas lock')
    assertEqual(await redisGet(key), null, 'lock hilang')
  })

  await runAsync('queue per-chat FIFO dengan TTL', async () => {
    const key = `whatsapp_queue:${owner.user.id}:test`

    await redisDel(key)
    await redisLpush(key, { n: 1 })
    await redisLpush(key, { n: 2 })
    await redisLpush(key, { n: 3 })
    await redisExpire(key, 300)

    const first = await redisRpop(key)
    const second = await redisRpop(key)
    assertEqual(first.n, 1, 'LPUSH + RPOP = FIFO')
    assertEqual(second.n, 2, 'urutan kedua terjaga')

    const ttl = await getRedisClient().ttl(key)
    assert(ttl > 0 && ttl <= 300, 'TTL queue terpasang')
    await redisDel(key)
  })

  await runAsync('pembeli WhatsApp tanpa customerPhone tetap jadi Customer', async () => {
    const products = await createTestProducts(ctx, owner.user.id, 1)
    const order = await createTestOrder(ctx, owner.user.id, products[0].id)

    await prisma.order.update({
      where: { id: order.id },
      data: {
        source: 'WHATSAPP',
        telegramId: null,
        customerPhone: null,
        customerName: 'Nining',
        whatsappId: '6281234509876@s.whatsapp.net',
      },
    })

    const stored = await prisma.order.findUnique({ where: { id: order.id } })
    const customer = await upsertCustomerFromOrder(stored, owner.user.id)

    assert(customer, 'customer dibuat dari JID WhatsApp')
    assertEqual(customer.phone, '6281234509876', 'nomor diturunkan dari JID')
    assertEqual(customer.hasWhatsapp, true, 'menandai kanal WhatsApp')

    const ticket = await createTicketFromOrder(stored, owner.user.id)
    assertEqual(
      ticket.customerContact,
      '6281234509876',
      'contact ticket memakai nomor, bukan JID',
    )
  })

  await runAsync('state chat ikut pindah saat @lid akhirnya terpetakan', async () => {
    const lidOwner = await createTestUser(ctx)
    const lid = '239689676136519@lid'
    const phoneJid = '6281234509876@s.whatsapp.net'
    const oldKey = `order:${lidOwner.user.id}:${lid}`
    const newKey = `order:${lidOwner.user.id}:${phoneJid}`
    const oldQueue = `whatsapp_queue:${lidOwner.user.id}:${lid}`
    const newQueue = `whatsapp_queue:${lidOwner.user.id}:${phoneJid}`

    await redisDel(oldKey, newKey)
    await getRedisClient().del(oldQueue, newQueue).catch(() => {})
    await redisSet(oldKey, { state: 'confirming', quantity: 2 }, 600)
    await getRedisClient().rpush(oldQueue, JSON.stringify({ seq: 1 }))

    await migrateChatState(lidOwner.user.id, lid, phoneJid)

    const moved = await redisGet(newKey)
    assertEqual(
      moved?.state,
      'confirming',
      'order yang sedang CONFIRMING tidak menggantung di kunci @lid',
    )
    assertEqual(moved?.quantity, 2, 'isi state ikut pindah')
    assertEqual(await redisGet(oldKey), null, 'kunci lama dibersihkan')
    assertEqual(
      await getRedisClient().llen(newQueue),
      1,
      'pesan yang menunggu di antrian chat lama ikut pindah',
    )

    await redisSet(oldKey, { state: 'confirming', quantity: 9 }, 600)
    await redisSet(newKey, { state: 'selecting_qty', quantity: 1 }, 600)

    await migrateChatState(lidOwner.user.id, lid, phoneJid)

    const kept = await redisGet(newKey)
    assertEqual(kept?.state, 'selecting_qty', 'state yang sudah ada di kunci tujuan tidak ditimpa')
    assertEqual(kept?.quantity, 1, 'isi tujuan tetap milik kunci tujuan')
    const tertinggal = await redisGet(oldKey)
    assertEqual(tertinggal?.quantity, 9, 'kunci sumber tidak dibuang saat bentrok')
    const ttlSumber = await getRedisClient().ttl(oldKey)
    assert(ttlSumber > 0, 'sisa state sumber tetap dibersihkan oleh TTL')

    await migrateChatState(lidOwner.user.id, phoneJid, phoneJid)
    await redisDel(oldKey, newKey)
    await getRedisClient().del(oldQueue, newQueue).catch(() => {})
  })
} catch (error) {
  console.error('❌ Test lifecycle gagal di luar runAsync:', error)
  process.exitCode = 1
} finally {
  for (const userId of ctx.createdUserIds) {
    await redisDel(`tenant_config:${userId}`).catch(() => {})
  }
  await ctx.cleanup().catch((err) => {
    console.error('[lifecycle] cleanup gagal:', err.message)
    process.exitCode = 1
  })
  mock.server.close()
  await prisma.$disconnect().catch(() => {})
  await redisQuit().catch(() => {})

  if (process.exitCode) {
    console.error('\n❌ Ada test lifecycle WhatsApp yang gagal.')
  } else {
    console.log('\n✅ Semua test lifecycle WhatsApp lulus.')
  }
}
