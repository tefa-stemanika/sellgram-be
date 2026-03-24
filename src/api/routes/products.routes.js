import { Router } from 'express'
import {
  createProductEndpoint,
  deleteProductEndpoint,
  getProductById,
  getProducts,
  updateProductEndpoint,
} from '../controllers/products.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const productsRouter = Router()

productsRouter.use(requireAuth)
productsRouter.get('/products', getProducts)
productsRouter.get('/products/:id', getProductById)
productsRouter.post('/products', createProductEndpoint)
productsRouter.put('/products/:id', updateProductEndpoint)
productsRouter.delete('/products/:id', deleteProductEndpoint)

export default productsRouter
