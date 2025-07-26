import express from 'express';
import {
  getTenantOnboarding,
  createOrUpdateTenantOnboarding,
  updateTenantOnboarding,
} from '../controllers/tenantOnboarding.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import { authorize } from '../middlewares/rbac.js';

const router = express.Router();

//Fetch current tenant’s onboarding (view permission)
router.get('/onboarding',verifyToken(),authorize('view_onboarding'),getTenantOnboarding);

//Upsert onboarding survey (create/complete onboarding)
router.post('/onboarding',verifyToken(),authorize('manage_onboarding'),createOrUpdateTenantOnboarding);

//Update onboarding fields 
router.patch('/onboarding',verifyToken(),authorize('manage_onboarding'),updateTenantOnboarding);

export default router;
