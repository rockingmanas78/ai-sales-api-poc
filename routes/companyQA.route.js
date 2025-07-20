import express from 'express';
import {
  getAllCompanyQA,
  getCompanyQAById,
  createCompanyQABulk,
  updateCompanyQA,
  deleteCompanyQA
} from '../controllers/companyQA.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

router.get('/qa', verifyToken(), authorize('view_qas'), getAllCompanyQA);
router.get('/qa/:qaId', verifyToken(), authorize('view_qas'), getCompanyQAById);

router.post('/qa', verifyToken(), authorize('manage_qas'), createCompanyQABulk);
router.patch('/qa/:qaId', verifyToken(), authorize('manage_qas'), updateCompanyQA);
router.delete('/qa/:qaId', verifyToken(), authorize('manage_qas'), deleteCompanyQA);

export default router;
