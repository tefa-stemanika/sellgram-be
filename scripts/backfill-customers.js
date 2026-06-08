import prisma from '../src/services/db.js'
import { upsertCustomerFromOrder } from '../src/services/customerService.js'

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: 'COMPLETED',
      customerId: null,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Backfilling ${orders.length} orders...`)

  let success = 0
  let skipped = 0

  for (const order of orders) {
    const result = await upsertCustomerFromOrder(order, order.userId)
    if (result) success++
    else skipped++
  }

  console.log(`Done. Success: ${success}, Skipped (no identifier): ${skipped}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
