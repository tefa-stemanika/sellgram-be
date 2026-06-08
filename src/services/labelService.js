import prisma from './db.js'

export async function getLabels(userId, filters = {}) {
  const {
    search,
    page = 1,
    limit = 20,
  } = filters

  const where = {
    userId,
    ...(search && {
      name: { contains: search, mode: 'insensitive' },
    }),
  }

  const [labels, total] = await Promise.all([
    prisma.label.findMany({
      where,
      include: { _count: { select: { tickets: true } } },
      orderBy: { name: 'asc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.label.count({ where }),
  ])

  return { labels, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
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
