import express from 'express';
import {
  createTenant,
  getTenantProfile,
  updateTenantProfile,
  getAvailablePlans,
  softDeleteTenant,
  getAllTenant
} from '../controllers/tenant.controllers.js';
import {detectZone} from '../middlewares/geo-detect.js';
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

router.post('/create',detectZone,createTenant)
router.get('/get', verifyToken(), authorize('view_tenant'), getAllTenant);
//  /tenant – Get current tenant’s profile, active plan, and usage caps
router.get('/profile/:tenantId', verifyToken(), authorize('view_tenant'), getTenantProfile);

//  /tenant – Update anything in tenant
router.patch('/update/:tenantId', verifyToken(), authorize('manage_tenant'), updateTenantProfile);

//  /plans – Public endpoint to list available plans
router.get('/plans', getAvailablePlans);
router.delete('/delete/:tenantId', verifyToken(), authorize('manage_tenant'), softDeleteTenant);

export default router;
