import prisma from '../../services/db.js'
import {
  createProduct,
  getAllProductsAdmin,
} from '../../services/productService.js'
import { ok, okPaginated, fail } from '../utils/response.js'
import * as stockService from '../../services/stockService.js'

export async function getProducts(req, res, next) {
  try {
    const { products, total, page, limit } = await getAllProductsAdmin(req.auth.userId, req.query)
    return okPaginated(res, products, total, page, limit, 'Get products success')
  } catch (error) {
    return next(error)
  }
}

export async function getProductById(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid product id', 400)
    }

    const product = await prisma.product.findFirst({
      where: { id, userId: req.auth.userId },
    })

    if (!product) {
      return fail(res, 'Product tidak ditemukan', 404)
    }

    return ok(res, product, 'Get product success')
  } catch (error) {
    return next(error)
  }
}

export async function createProductEndpoint(req, res, next) {
  try {
    const name = String(req.body?.name || '').trim()
    const description = String(req.body?.description || '').trim()
    const price = Number(req.body?.price)
    const emoji = req.body?.emoji

    if (!name || !description || !Number.isFinite(price) || price <= 0) {
      return fail(res, 'name, description, dan price valid wajib diisi', 400)
    }

    const product = await createProduct(req.auth.userId, {
      name,
      description,
      price: Math.floor(price),
      emoji,
      stock: req.body?.stock !== undefined ? Number(req.body.stock) : undefined,
      stockEnabled: req.body?.stockEnabled !== undefined ? Boolean(req.body.stockEnabled) : undefined,
      allowOversell: req.body?.allowOversell !== undefined ? Boolean(req.body.allowOversell) : undefined,
      lowStockAlert: req.body?.lowStockAlert !== undefined ? Number(req.body.lowStockAlert) : undefined,
    })

    return ok(res, product, 'Create product success', 201)
  } catch (error) {
    return next(error)
  }
}

export async function updateProductEndpoint(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid product id', 400)
    }

    const existing = await prisma.product.findFirst({
      where: { id, userId: req.auth.userId },
    })

    if (!existing) {
      return fail(res, 'Product tidak ditemukan', 404)
    }

    const patch = {
      ...(req.body?.name !== undefined && {
        name: String(req.body.name).trim(),
      }),
      ...(req.body?.description !== undefined && {
        description: String(req.body.description).trim(),
      }),
      ...(req.body?.price !== undefined && {
        price: Math.floor(Number(req.body.price)),
      }),
      ...(req.body?.emoji !== undefined && { emoji: String(req.body.emoji) }),
      ...(req.body?.isAvailable !== undefined && {
        isAvailable: Boolean(req.body.isAvailable),
      }),
      ...(req.body?.stockEnabled !== undefined && {
        stockEnabled: Boolean(req.body.stockEnabled),
      }),
      ...(req.body?.allowOversell !== undefined && {
        allowOversell: Boolean(req.body.allowOversell),
      }),
      ...(req.body?.lowStockAlert !== undefined && {
        lowStockAlert: Number(req.body.lowStockAlert),
      }),
    }

    const updated = await prisma.product.update({
      where: { id },
      data: patch,
    })

    return ok(res, updated, 'Update product success')
  } catch (error) {
    return next(error)
  }
}

export async function deleteProductEndpoint(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid product id', 400)
    }

    const existing = await prisma.product.findFirst({
      where: { id, userId: req.auth.userId },
    })

    if (!existing) {
      return fail(res, 'Product tidak ditemukan', 404)
    }

    const deleted = await prisma.product.update({
      where: { id },
      data: { isAvailable: false },
    })

    return ok(res, deleted, 'Delete product success')
  } catch (error) {
    return next(error)
  }
}

export async function restockProductEndpoint(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    const quantity = Number(req.body?.quantity)
    const note = req.body?.note || null

    if (!id) return fail(res, 'Invalid product id', 400)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return fail(res, 'Quantity harus lebih dari 0', 400)
    }

    const product = await stockService.restockProduct(id, req.auth.userId, quantity, note)
    return ok(res, product, 'Restock success')
  } catch (error) {
    return next(error)
  }
}

export async function adjustStockEndpoint(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    const stock = Number(req.body?.stock)
    const note = req.body?.note || null

    if (!id) return fail(res, 'Invalid product id', 400)
    if (!Number.isFinite(stock) || stock < 0) {
      return fail(res, 'Stock harus berupa angka >= 0', 400)
    }

    const product = await stockService.adjustStock(id, req.auth.userId, stock, note)
    return ok(res, product, 'Adjust stock success')
  } catch (error) {
    return next(error)
  }
}

export async function getStockLogsEndpoint(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return fail(res, 'Invalid product id', 400)

    const result = await stockService.getStockLogs(id, req.auth.userId, req.query)
    return okPaginated(res, result.logs, result.total, result.page, result.limit, 'Get stock logs success')
  } catch (error) {
    return next(error)
  }
}
