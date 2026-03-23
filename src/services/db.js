// src/services/db.js
// Singleton Prisma Client — import file ini di mana saja butuh akses database.
// Menggunakan singleton pattern agar tidak membuat koneksi baru setiap kali diimport.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})

// Graceful shutdown — tutup koneksi saat proses dihentikan
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

export default prisma
