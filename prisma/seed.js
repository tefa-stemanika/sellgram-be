// prisma/seed.js
// Jalankan dengan: npx prisma db seed
// (atau: node prisma/seed.js)

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const DEFAULT_SEED_USER_EMAIL = 'seed-owner@localhost.local'

const seedProducts = [
  {
    name: 'Nasi Goreng Spesial',
    description: 'Nasi goreng dengan telur, ayam, dan kerupuk',
    price: 25000,
    emoji: '🍳',
  },
  {
    name: 'Mie Ayam Bakso',
    description: 'Mie ayam dengan bakso jumbo dan pangsit goreng',
    price: 20000,
    emoji: '🍜',
  },
  {
    name: 'Es Teh Manis',
    description: 'Teh manis dingin segar',
    price: 5000,
    emoji: '🧋',
  },
  {
    name: 'Jus Alpukat',
    description: 'Jus alpukat segar dengan susu kental manis',
    price: 15000,
    emoji: '🥑',
  },
  {
    name: 'Ayam Bakar',
    description: 'Ayam bakar bumbu kecap dengan nasi dan lalapan',
    price: 35000,
    emoji: '🍗',
  },
]

async function main() {
  console.log('🌱 Seeding products...')

  const user = await prisma.user.upsert({
    where: { email: DEFAULT_SEED_USER_EMAIL },
    update: { isActive: true },
    create: {
      email: DEFAULT_SEED_USER_EMAIL,
      passwordHash: 'seed-password-hash',
      name: 'Seed Store Owner',
      plan: 'PRO',
      isActive: true,
    },
  })

  for (const product of seedProducts) {
    const existing = await prisma.product.findFirst({
      where: { userId: user.id, name: product.name },
    })

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: product,
      })
      continue
    }

    await prisma.product.create({
      data: { userId: user.id, ...product, isAvailable: true },
    })
  }

  const count = await prisma.product.count({ where: { userId: user.id } })
  console.log(
    `✅ Selesai — ${count} produk tersimpan untuk user ${DEFAULT_SEED_USER_EMAIL}.`,
  )
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
