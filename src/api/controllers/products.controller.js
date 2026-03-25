import prisma from '../../services/db.js'
import {
  createProduct,
  getAllProductsAdmin,
} from '../../services/productService.js'
import { ok, fail } from '../utils/response.js'

export async function getProducts(req, res, next) {
  try {
    const data = await getAllProductsAdmin(req.auth.userId)
    return ok(res, data, 'Get products success')
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
