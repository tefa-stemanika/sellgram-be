// prisma/seed.js
// Jalankan dengan: npx prisma db seed
// (atau: node prisma/seed.js)

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

  for (const product of seedProducts) {
    await prisma.product.upsert({
      where: { id: seedProducts.indexOf(product) + 1 },
      update: product,
      create: product,
    })
  }

  const count = await prisma.product.count()
  console.log(`✅ Selesai — ${count} produk tersimpan di database.`)
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
