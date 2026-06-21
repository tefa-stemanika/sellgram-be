import prisma from './db.js'
import { resolveDerivedField } from './derivedFieldResolver.js'

const CUSTOMER_FIELD_ALLOWED = ['name', 'phone', 'email', 'username']

function getCustomerFieldValue(customer, fieldName) {
  if (!CUSTOMER_FIELD_ALLOWED.includes(fieldName)) return null
  const value = customer[fieldName]
  return value ?? null
}

export async function loadMappings(broadcastId, userId) {
  const mappings = await prisma.broadcastVariableMapping.findMany({
    where: { broadcastId, userId },
    orderBy: { variableIndex: 'asc' },
  })
  return mappings
}

export async function renderTemplate(content, mappings, customer, userId, broadcastId) {
  const errors = []
  const resolved = []

  for (const mapping of mappings) {
    const { variableIndex, sourceType, sourceValue } = mapping
    let value = null

    if (sourceType === 'CUSTOMER_FIELD') {
      value = getCustomerFieldValue(customer, sourceValue)
      if (value === null) {
        errors.push(`Variabel {{${variableIndex}}} (Customer.${sourceValue}) kosong untuk customer ini`)
      }
    } else if (sourceType === 'STATIC_VALUE') {
      value = sourceValue
    } else if (sourceType === 'DERIVED_FIELD') {
      value = await resolveDerivedField(customer.id, userId, sourceValue)
      if (value === null) {
        errors.push(`Variabel {{${variableIndex}}} (${sourceValue}) gagal di-resolve untuk customer ini`)
      }
    } else {
      errors.push(`Variabel {{${variableIndex}}} memiliki tipe sumber tidak dikenal: ${sourceType}`)
    }

    resolved.push({ index: variableIndex, value })
  }

  let rendered = content
  for (const r of resolved) {
    rendered = rendered.replace(new RegExp(`\\{\\{${r.index}\\}\\}`, 'g'), r.value ?? `{{${r.index}}}`)
  }

  return { rendered, errors, resolved }
}

export async function validateMappings(broadcastId, userId) {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    select: { templateId: true, content: true, message: true },
  })
  if (!broadcast) return { valid: true, errors: [] }

  if (!broadcast.templateId) return { valid: true, errors: [] }

  const count = await prisma.broadcastVariableMapping.count({
    where: { broadcastId, userId },
  })
  if (count === 0) {
    return { valid: false, errors: ['Belum ada mapping variabel. Setiap variabel di template harus di-mapping.'] }
  }

  const template = await prisma.campaignTemplate.findUnique({
    where: { id: broadcast.templateId },
    select: { variableCount: true },
  })
  if (template && count < template.variableCount) {
    return {
      valid: false,
      errors: [`Template memiliki ${template.variableCount} variabel, tapi hanya ${count} yang sudah di-mapping.`],
    }
  }

  return { valid: true, errors: [] }
}

export async function getSampleCustomer(userId, filters) {
  const where = { userId, ...(filters?.hasTelegram === 'true' ? { hasTelegram: true } : {}) }
  const customer = await prisma.customer.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, phone: true, email: true, username: true },
  })
  return customer
}

export async function dryRunValidation(broadcastId, userId, customerWhere) {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    select: { templateId: true, message: true },
  })
  if (!broadcast || !broadcast.templateId) return { total: 0, invalidCount: 0, invalidSamples: [] }

  const mappings = await loadMappings(broadcastId, userId)
  const content = await getTemplateContent(broadcast.templateId)

  const customers = await prisma.customer.findMany({
    where: customerWhere,
    select: { id: true, name: true, phone: true, email: true, username: true },
    take: 500,
  })

  let invalidCount = 0
  const invalidSamples = []

  for (const customer of customers) {
    const { errors } = await renderTemplate(content, mappings, customer, userId, broadcastId)
    if (errors.length > 0) {
      invalidCount++
      if (invalidSamples.length < 10) {
        invalidSamples.push({ customerId: customer.id, name: customer.name, errors })
      }
    }
  }

  return { total: customers.length, invalidCount, invalidSamples }
}

async function getTemplateContent(templateId) {
  if (!templateId) return ''
  const template = await prisma.campaignTemplate.findUnique({
    where: { id: templateId },
    select: { content: true },
  })
  return template?.content || ''
}

export { getTemplateContent }
