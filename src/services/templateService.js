import prisma from './db.js'

const ALLOWED_SORT = ['createdAt', 'name', 'updatedAt', 'variableCount']

const MAX_VARIABLES = 20

function detectVariables(content) {
  const regex = /\{\{(\d+)\}\}/g
  const matches = new Set()
  let match
  while ((match = regex.exec(content)) !== null) {
    matches.add(parseInt(match[1], 10))
  }
  const indices = Array.from(matches).sort((a, b) => a - b)
  if (indices.length > MAX_VARIABLES) {
    throw Object.assign(
      new Error(`Template maksimal ${MAX_VARIABLES} variabel. Ditemukan ${indices.length}.`),
      { statusCode: 400 }
    )
  }
  return indices
}

export async function getTemplates(userId, filters = {}) {
  const { page = 1, limit = 20 } = filters
  const safeSortBy = ALLOWED_SORT.includes(filters.sortBy) ? filters.sortBy : 'createdAt'
  const safeSortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'

  const where = { userId }

  const [templates, total] = await Promise.all([
    prisma.campaignTemplate.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.campaignTemplate.count({ where }),
  ])

  return { templates, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
}

export async function getTemplateById(templateId, userId) {
  return prisma.campaignTemplate.findFirst({
    where: { id: templateId, userId },
  })
}

export async function createTemplate(userId, data) {
  const { name, content, channel, variables } = data
  if (!name || !content) throw Object.assign(new Error('name dan content wajib diisi'), { statusCode: 400 })

  const detected = detectVariables(content)

  const varMeta = []
  for (const idx of detected) {
    const existing = Array.isArray(variables) ? variables.find((v) => v.index === idx) : null
    if (!existing?.label) {
      throw Object.assign(
        new Error(`Variabel {{${idx}}} wajib memiliki label`),
        { statusCode: 400 }
      )
    }
    varMeta.push({
      index: idx,
      label: existing.label,
      sample: existing.sample || `[Sample {{${idx}}}]`,
    })
  }

  return prisma.campaignTemplate.create({
    data: {
      userId,
      name,
      content,
      channel: channel || 'TELEGRAM',
      variableCount: detected.length,
      variables: varMeta,
    },
  })
}

export async function updateTemplate(templateId, userId, data) {
  const template = await prisma.campaignTemplate.findFirst({ where: { id: templateId, userId } })
  if (!template) return null

  const { name, content, channel, variables } = data

  const updateData = {}
  if (name !== undefined) updateData.name = name
  if (channel !== undefined) updateData.channel = channel

  if (content !== undefined) {
    const detected = detectVariables(content)
    updateData.content = content
    updateData.variableCount = detected.length

    const varMeta = []
    for (const idx of detected) {
      const existing = Array.isArray(variables) ? variables.find((v) => v.index === idx) : null
      if (!existing?.label) {
        throw Object.assign(
          new Error(`Variabel {{${idx}}} wajib memiliki label`),
          { statusCode: 400 }
        )
      }
      varMeta.push({
        index: idx,
        label: existing.label,
        sample: existing.sample || `[Sample {{${idx}}}]`,
      })
    }
    updateData.variables = varMeta
  }

  return prisma.campaignTemplate.update({ where: { id: templateId }, data: updateData })
}

export async function deleteTemplate(templateId, userId) {
  const template = await prisma.campaignTemplate.findFirst({ where: { id: templateId, userId } })
  if (!template) return null

  const broadcastCount = await prisma.broadcast.count({
    where: { templateId, userId, status: { notIn: ['SENT', 'FAILED'] } },
  })
  if (broadcastCount > 0) {
    throw Object.assign(
      new Error(`Tidak bisa menghapus template yang masih dipakai oleh ${broadcastCount} broadcast aktif.`),
      { statusCode: 400 }
    )
  }

  await prisma.campaignTemplate.delete({ where: { id: templateId } })
  return true
}

export async function getTemplatePreview(templateId, userId) {
  const template = await prisma.campaignTemplate.findFirst({ where: { id: templateId, userId } })
  if (!template) return null

  let preview = template.content
  const meta = template.variables || []
  for (const v of meta) {
    const sample = v.sample || `[Sample {{${v.index}}}]`
    preview = preview.replace(new RegExp(`\\{\\{${v.index}\\}\\}`, 'g'), sample)
  }

  return { ...template, preview }
}
