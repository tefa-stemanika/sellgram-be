import 'dotenv/config'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5505'

const JWT = process.env.JWT || process.argv[2]

if (!JWT) {
  console.error('Usage: JWT=<token> node tests/test-product-limit.js')
  console.error('   or: node tests/test-product-limit.js <token>')
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
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text()
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  console.log(`Target: ${BASE_URL}/api\n`)

  const me = await api('/api/auth/me')
  if (!me.ok) {
    console.error('Token invalid:', me.status, JSON.stringify(me.data))
    process.exit(1)
  }
  const plan = me.data?.data?.plan || me.data?.plan
  console.log(`User plan: ${plan}\n`)

  const LIMITS = { FREE: 10, STARTER: 50, PRO: Infinity }
  const maxProducts = LIMITS[plan]
  if (!maxProducts) {
    console.error(`Unknown plan: ${plan}`)
    process.exit(1)
  }

  const label = maxProducts === Infinity ? 'unlimited' : maxProducts
  console.log(`Testing product creation limit for ${plan} plan (limit: ${label})\n`)

  const created = []
  for (let i = 1; i <= (maxProducts === Infinity ? 5 : maxProducts + 2); i++) {
    const { status, ok, data } = await api('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: `[LIMIT-TEST] Product #${i}`,
        description: 'Auto-created by test-product-limit.js',
        price: 1,
        emoji: '📦',
      }),
    })

    if (status === 403 && data?.code === 'PLAN_LIMIT_EXCEEDED') {
      console.log(`  #${i}: BLOCKED — ${data.message}`)
      break
    }

    if (ok) {
      const id = data?.data?.id || data?.id
      console.log(`  #${i}: CREATED (id: ${id})`)
      if (id) created.push(id)
    } else {
      console.log(`  #${i}: FAILED — status=${status}`, JSON.stringify(data).slice(0, 200))
      break
    }
  }

  const expected = Math.min(created.length + 1, maxProducts === Infinity ? created.length + 1 : maxProducts)
  const pass = maxProducts === Infinity || created.length >= maxProducts

  console.log(`\nResult: ${created.length} products created (limit: ${label})`)
  console.log(pass ? 'PASS' : 'FAIL')
  console.log(`\nCleaning up ${created.length} products...`)

  for (const id of created) {
    const r = await api(`/api/products/${id}`, { method: 'DELETE' })
    if (!r.ok) console.error(`  Failed to delete ${id}: ${r.status}`)
  }

  console.log('Cleanup done.')
  process.exit(pass ? 0 : 1)
}

main()
