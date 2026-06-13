import { decrypt } from '../../../utils/encryption.js'

const FETCH_TIMEOUT_MS = 15000

export async function execute({ userId, order, config }) {
  const apiUrl = config.apiUrl
  if (!apiUrl) throw new Error('apiUrl tidak dikonfigurasi')

  const method = (config.apiMethod || 'POST').toUpperCase()
  const headers = { ...(config.apiHeaders || {}) }

  if (config.apiCredentials) {
    const decrypted = decrypt(config.apiCredentials)
    const parsed = JSON.parse(decrypted)
    for (const [key, value] of Object.entries(parsed)) {
      headers[key] = value
    }
  }

  if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }

  let payload = {}
  if (config.apiPayloadTemplate && order.orderItems?.[0]?.product) {
    const product = order.orderItems[0].product
    payload = JSON.parse(
      config.apiPayloadTemplate
        .replace(/\{\{customer_phone\}\}/g, order.customerPhone || order.customer?.phone || '')
        .replace(/\{\{customer_name\}\}/g, order.customerName || '')
        .replace(/\{\{order_id\}\}/g, order.orderId)
        .replace(/\{\{product_name\}\}/g, product.name)
        .replace(/\{\{product_price\}\}/g, String(product.price)),
    )
  }

  const fetchOptions = {
    method,
    headers,
  }

  if (method !== 'GET') {
    fetchOptions.body = JSON.stringify(payload)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(apiUrl, {
      ...fetchOptions,
      signal: controller.signal,
    })
    const text = await response.text()
    let result
    try {
      result = JSON.parse(text)
    } catch {
      result = text
    }

    if (config.apiSuccessPath && config.apiSuccessValue) {
      const actualValue = getNestedValue(result, config.apiSuccessPath)
      if (String(actualValue) !== config.apiSuccessValue) {
        throw new Error(`API gagal: expected ${config.apiSuccessValue}, got ${actualValue}`)
      }
    }

    const deliveryContent = config.apiResultPath
      ? getNestedValue(result, config.apiResultPath)
      : result

    return {
      success: true,
      delivery: String(deliveryContent),
      note: null,
      metadata: { apiResponse: typeof result === 'object' ? { ...result } : result },
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return current[key]
    }
    return undefined
  }, obj)
}
