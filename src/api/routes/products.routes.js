import { Router } from 'express'
import {
  createProductEndpoint,
  deleteProductEndpoint,
  getProductById,
  getProducts,
  updateProductEndpoint,
  restockProductEndpoint,
  adjustStockEndpoint,
  getStockLogsEndpoint,
} from '../controllers/products.controller.js'
import { requireAuth } from '../middlewares/auth.middleware.js'

const productsRouter = Router()

productsRouter.use(requireAuth)
productsRouter.get('/products', getProducts)
productsRouter.get('/products/:id', getProductById)
productsRouter.post('/products', createProductEndpoint)
productsRouter.put('/products/:id', updateProductEndpoint)
productsRouter.delete('/products/:id', deleteProductEndpoint)
productsRouter.post('/products/:id/restock', restockProductEndpoint)
productsRouter.patch('/products/:id/stock', adjustStockEndpoint)
productsRouter.get('/products/:id/stock-logs', getStockLogsEndpoint)

export default productsRouter
