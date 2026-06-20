import 'dotenv/config'
import prisma from '../src/services/db.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5505'
const JWT = process.env.JWT || process.argv[2]

if (!JWT) {
  console.error('Usage: JWT=<token> node tests/test-broadcast.js')
  console.error('   or: node tests/test-broadcast.js <token>')
  process.exit(1)
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  const me = await api('/api/auth/me')
  if (!me.ok) {
    console.error('Token invalid:', me.status)
    process.exit(1)
  }
  const user = me.data?.data || me.data
  const userId = user.id
  const plan = user.plan
  console.log(`User: ${userId}`)
  console.log(`Plan: ${plan}`)

  const LIMITS = { FREE: 0, STARTER: 50, PRO: Infinity }
  const maxBroadcasts = LIMITS[plan]

  if (maxBroadcasts === 0) {
    console.log('\nFREE plan: broadcast tidak diizinkan.')
    console.log('Testing bahwa create broadcast ditolak...\n')

    const r = await api('/api/broadcasts', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', message: 'Hello', filters: {} }),
    })
    if (r.status === 403 && r.data?.code === 'FEATURE_NOT_ALLOWED') {
      console.log('PASS: Broadcast creation blocked (FEATURE_NOT_ALLOWED)')
    } else {
      console.log('FAIL: Expected 403 FEATURE_NOT_ALLOWED, got', r.status, JSON.stringify(r.data).slice(0, 200))
      process.exit(1)
    }

    const list = await api('/api/broadcasts')
    if (list.ok) {
      const items = list.data?.data || []
      console.log(`PASS: List broadcasts works (${items.length} items)`)
    }
    process.exit(0)
  }

  const isUnlimited = maxBroadcasts === Infinity

  // 1. Cek list broadcast (kosong)
  console.log('\n1. List broadcasts (seharusnya kosong)...')
  const list1 = await api('/api/broadcasts')
  if (!list1.ok) {
    console.log('FAIL: Gagal list broadcasts:', JSON.stringify(list1.data).slice(0, 200))
    process.exit(1)
  }
  console.log(`   ${(list1.data?.data || []).length} broadcasts ditemukan`)

  // 2. Preview: hitung customer dengan Telegram
  console.log('\n2. Preview customer Telegram...')
  const prev = await api('/api/broadcasts/preview', {
    method: 'POST',
    body: JSON.stringify({ filters: { hasTelegram: 'true' } }),
  })
  console.log(`   Preview response: ${prev.status} ${JSON.stringify(prev.data).slice(0, 150)}`)

  // 3. Create broadcast (DRAFT) — but first check if there are any customers
  // that would match the empty filter
  const customerCount = await prisma.customer.count({ where: { userId } })
  console.log(`\n3. Total customers: ${customerCount}`)

  if (customerCount === 0) {
    console.log('   SKIP: Tidak ada customer untuk broadcast. Buat dummy customer...')
    await prisma.customer.create({
      data: {
        userId,
        name: 'Test Customer',
        hasTelegram: true,
        telegramId: 123456789,
        source: 'MANUAL',
      },
    })
    console.log('   Dummy customer created')
  }

  // 4. Create broadcast
  console.log('\n4. Create broadcast...')
  const create = await api('/api/broadcasts', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Broadcast',
      message: 'Halo *{name}*! Ini pesan test dari sistem broadcast.',
      filters: { hasTelegram: 'true' },
    }),
  })
  if (!create.ok) {
    console.log(`   FAIL: ${create.status} ${JSON.stringify(create.data).slice(0, 200)}`)
    process.exit(1)
  }
  const broadcastId = create.data?.data?.id || create.data?.id
  console.log(`   Broadcast ID: ${broadcastId}`)
  console.log(`   Status: ${create.data?.data?.status || create.data?.status}`)

  // 5. List broadcasts (should have 1)
  console.log('\n5. List broadcasts (seharusnya 1)...')
  const list2 = await api('/api/broadcasts')
  if (!list2.ok) {
    console.log('FAIL: Gagal list broadcasts:', JSON.stringify(list2.data).slice(0, 200))
    process.exit(1)
  }
  const items = list2.data?.data || []
  console.log(`   ${items.length} broadcasts ditemukan`)

  // 6. Get broadcast detail
  console.log('\n6. Get broadcast detail...')
  const detail = await api(`/api/broadcasts/${broadcastId}`)
  if (!detail.ok) {
    console.log('FAIL:', JSON.stringify(detail.data).slice(0, 200))
    process.exit(1)
  }
  console.log(`   Name: ${detail.data?.data?.name}`)
  console.log(`   Status: ${detail.data?.data?.status}`)
  console.log(`   Total customers: ${detail.data?.data?.totalCustomers}`)

  // 7. Update broadcast
  console.log('\n7. Update broadcast name...')
  const update = await api(`/api/broadcasts/${broadcastId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Test Broadcast (Updated)' }),
  })
  if (!update.ok) {
    console.log('FAIL:', JSON.stringify(update.data).slice(0, 200))
    process.exit(1)
  }
  console.log(`   Updated name: ${update.data?.data?.name}`)

  // 8. Send broadcast (will be DRAFT → SENDING → worker processes)
  console.log('\n8. Start sending broadcast...')
  const send = await api(`/api/broadcasts/${broadcastId}/send`, { method: 'POST' })
  if (!send.ok) {
    // This might fail if bot isn't active - that's expected
    console.log(`   Send result: ${send.status} ${JSON.stringify(send.data).slice(0, 200)}`)
    if (send.status === 400) {
      console.log('   (Expected jika bot tidak aktif)')
    }
  } else {
    console.log(`   Status: ${send.data?.data?.status}`)
  }

  // 9. Get recipients
  console.log('\n9. List recipients...')
  const recip = await api(`/api/broadcasts/${broadcastId}/recipients`)
  if (recip.ok) {
    const rdata = recip.data?.data || []
    console.log(`   ${rdata.length} recipients`)
    if (rdata.length > 0) {
      console.log(`   First: ${rdata[0].status} ${rdata[0].error || ''}`)
    }
  } else {
    console.log(`   Recipients: ${recip.status} ${JSON.stringify(recip.data).slice(0, 100)}`)
  }

  // 10. Delete broadcast (should fail if status !== DRAFT)
  console.log('\n10. Delete broadcast...')
  const del = await api(`/api/broadcasts/${broadcastId}`, { method: 'DELETE' })
  console.log(`   Delete: ${del.status} ${JSON.stringify(del.data).slice(0, 100)}`)

  console.log('\nALL TESTS COMPLETED')
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
