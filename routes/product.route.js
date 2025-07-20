import express from 'express';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
} from '../controllers/product.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

router.get('/products', verifyToken(), authorize('view_products'), getAllProducts);
router.get('/products/:productId', verifyToken(), authorize('view_products'), getProductById);
router.post('/products', verifyToken(), authorize('manage_products'), createProduct);
router.patch('/', verifyToken(), authorize('manage_products'), updateProduct);
router.delete('/', verifyToken(), authorize('manage_products'), deleteProduct);

export default router;
