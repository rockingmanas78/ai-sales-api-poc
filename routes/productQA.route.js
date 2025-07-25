import express from 'express'
import {
  getAllQA,
  getOneQA,
  bulkCreateQA,
  updateQA,
  deleteQA,
} from '../controllers/productQA.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router({ mergeParams: true })

router.get('/',verifyToken(), authorize('view_qas'), getAllQA)
router.get('/:qaId',verifyToken(), authorize('view_qas'), getOneQA)
router.post('/',verifyToken(), authorize('manage_qas'), bulkCreateQA)
router.patch('/:qaId',verifyToken(), authorize('manage_qas'), updateQA)
router.delete('/:qaId',verifyToken(), authorize('manage_qas'), deleteQA)

export default router
