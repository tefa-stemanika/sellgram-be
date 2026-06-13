import prisma from '../../services/db.js'
import { ok, fail } from '../utils/response.js'
import { encrypt } from '../../utils/encryption.js'

const SUPPORTED_VARS_DELIVERY = ['order_id', 'product_name', 'customer_name', 'customer_phone', 'result']
const SUPPORTED_VARS_API = ['order_id', 'product_name', 'customer_name', 'customer_phone', 'result', 'product_price']

export async function getFulfillmentConfig(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) return fail(res, 'Product not found', 404)

  const config = await prisma.fulfillmentConfig.findUnique({
    where: { productId },
  })
  return ok(res, config || null)
}

export async function upsertFulfillmentConfig(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) return fail(res, 'Product not found', 404)

  const { type, manualNote, apiUrl, apiMethod, apiHeaders, apiPayloadTemplate, apiCredentials,
    apiSuccessPath, apiSuccessValue, apiResultPath, deliveryMessage, isActive } = req.body

  if (deliveryMessage) {
    const matches = deliveryMessage.match(/\{\{(\w+)\}\}/g)
    if (matches) {
      const unsupported = matches
        .map(v => v.slice(2, -2))
        .filter(v => !SUPPORTED_VARS_DELIVERY.includes(v))
      if (unsupported.length) {
        const listed = unsupported.map(v => `{{${v}}}`).join(', ')
        return fail(res, `Variable tidak didukung: ${listed}. Yang didukung: ${SUPPORTED_VARS_DELIVERY.map(v => `{{${v}}}`).join(', ')}`, 400)
      }
    }
  }

  if (apiPayloadTemplate) {
    try {
      JSON.parse(apiPayloadTemplate)
    } catch {
      return fail(res, 'apiPayloadTemplate harus berupa JSON yang valid', 400)
    }

    const matches = apiPayloadTemplate.match(/\{\{(\w+)\}\}/g)
    if (matches) {
      const unsupported = matches
        .map(v => v.slice(2, -2))
        .filter(v => !SUPPORTED_VARS_API.includes(v))
      if (unsupported.length) {
        const listed = unsupported.map(v => `{{${v}}}`).join(', ')
        return fail(res, `Variable tidak didukung di apiPayloadTemplate: ${listed}. Yang didukung: ${SUPPORTED_VARS_API.map(v => `{{${v}}}`).join(', ')}`, 400)
      }
    }
  }

  let encryptedCredentials = null
  if (apiCredentials) {
    try {
      JSON.parse(apiCredentials)
    } catch {
      return fail(res, 'apiCredentials harus berupa JSON yang valid', 400)
    }
    encryptedCredentials = encrypt(apiCredentials)
  }

  const data = {
    userId,
    productId,
    type,
    manualNote: manualNote || null,
    apiUrl: apiUrl || null,
    apiMethod: apiMethod || 'POST',
    apiHeaders: apiHeaders || null,
    apiPayloadTemplate: apiPayloadTemplate || null,
    apiCredentials: encryptedCredentials,
    apiSuccessPath: apiSuccessPath || null,
    apiSuccessValue: apiSuccessValue || null,
    apiResultPath: apiResultPath || null,
    deliveryMessage: deliveryMessage || null,
    isActive: isActive !== undefined ? isActive : true,
  }

  const config = await prisma.fulfillmentConfig.upsert({
    where: { productId },
    create: data,
    update: data,
  })

  return ok(res, config)
}

export async function deleteFulfillmentConfig(req, res) {
  const { productId } = req.params
  const existing = await prisma.fulfillmentConfig.findUnique({
    where: { productId },
  })
  if (!existing) return fail(res, 'Config not found', 404)

  await prisma.fulfillmentConfig.delete({ where: { productId } })
  return ok(res, { deleted: true })
}
