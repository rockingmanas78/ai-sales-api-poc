import express from 'express';
import {
  getCompanyProfile,
  createCompanyProfile,
  upsertCompanyProfile,
  deleteCompanyProfile
} from '../controllers/companyProfile.controller.js';
import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js'; 

const router = express.Router();

router.get('/',verifyToken(), authorize('view_tenant'), getCompanyProfile);
router.post('/',verifyToken(), authorize('manage_tenant'), createCompanyProfile);
router.put('/:companyId',verifyToken(), authorize('manage_tenant'), upsertCompanyProfile);
router.delete('/:companyId',verifyToken(), authorize('manage_tenant'), deleteCompanyProfile);


export default router;