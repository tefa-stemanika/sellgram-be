import prisma from './db.js'

export async function getLabels(userId) {
  return prisma.label.findMany({
    where: { userId },
    include: { _count: { select: { tickets: true } } },
    orderBy: { name: 'asc' },
  })
}

export async function createLabel(userId, { name, color }) {
  return prisma.label.create({ data: { userId, name, color } })
}

export async function updateLabel(labelId, userId, data) {
  const label = await prisma.label.findFirst({ where: { id: labelId, userId } })
  if (!label) throw new Error('Label not found')
  return prisma.label.update({ where: { id: labelId }, data })
}

export async function deleteLabel(labelId, userId) {
  const label = await prisma.label.findFirst({ where: { id: labelId, userId } })
  if (!label) throw new Error('Label not found')
  return prisma.label.delete({ where: { id: labelId } })
}
