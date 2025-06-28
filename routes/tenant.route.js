import express from 'express';
import {
  createTenant,
  getTenantProfile,
  updateTenantProfile,
  getAvailablePlans,
  softDeleteTenant,
  getAllTenant
} from '../controllers/tenant.controllers.js';
import {detectZone} from '../middlewares/geo-detect.js'
const router = express.Router();

router.post('/create',detectZone,createTenant)
router.get('/get',getAllTenant);
//  /tenant – Get current tenant’s profile, active plan, and usage caps
router.get('/profile/:tenantId', getTenantProfile);

//  /tenant – Update anything in tenant
router.patch('/update/:tenantId', updateTenantProfile);

//  /plans – Public endpoint to list available plans
router.get('/plans', getAvailablePlans);
router.delete('/delete/:tenantId',softDeleteTenant)

export default router;
