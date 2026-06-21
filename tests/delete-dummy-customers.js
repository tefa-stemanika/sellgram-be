import 'dotenv/config'
import prisma from '../src/services/db.js'
import { verifyAuthToken } from '../src/utils/jwt.js'

const JWT = process.env.JWT || process.argv[2]

if (!JWT) {
  console.log('Gunakan: node tests/delete-dummy-customers.js <jwt>')
  console.log('Atau set JWT di .env')
  process.exit(1)
}

let userId
try {
  const decoded = verifyAuthToken(JWT)
  userId = decoded.userId
} catch {
  console.error('JWT tidak valid')
  process.exit(1)
}

console.log(`Mencari customer dengan prefix "Dummy" untuk user ${userId}...`)

const total = await prisma.customer.count({
  where: { userId, name: { startsWith: 'Dummy' } },
})

if (total === 0) {
  console.log('Tidak ada customer dengan prefix "Dummy".')
  await prisma.$disconnect()
  process.exit(0)
}

console.log(`Ditemukan ${total} customer dummy.\n`)

const BATCH = 100
let deleted = 0

for (let i = 0; i < total; i += BATCH) {
  const batch = await prisma.customer.findMany({
    where: { userId, name: { startsWith: 'Dummy' } },
    select: { id: true },
    take: BATCH,
    skip: i,
  })
  if (batch.length === 0) continue

  const ids = batch.map((c) => c.id)

  // 1. Lepas relasi dari order
  try {
    await prisma.order.updateMany({
      where: { customerId: { in: ids } },
      data: { customerId: null },
    })
  } catch (err) {
    console.error(`\n  Gagal update orders: ${err.message}`)
  }

  // 2. Hapus broadcast recipient
  try {
    await prisma.broadcastRecipient.deleteMany({
      where: { customerId: { in: ids } },
    })
  } catch (err) {
    console.error(`\n  Gagal hapus broadcast recipients: ${err.message}`)
  }

  // 3. Hapus customer auth (cascade)
  try {
    await prisma.customerAuth.deleteMany({
      where: { customerId: { in: ids } },
    })
  } catch {} // opsional

  // 4. Hapus customer
  try {
    await prisma.customer.deleteMany({
      where: { id: { in: ids }, userId },
    })
    deleted += ids.length
    process.stdout.write(`\r  Deleted ${deleted}/${total} customers...`)
  } catch (err) {
    console.error(`\n  Gagal hapus customer batch: ${err.message}`)
  }
}

console.log(`\n\n✅ ${deleted} dummy customers deleted!`)
await prisma.$disconnect()
