import { Router } from 'express';
import { createTenant, getTenants } from '../controllers/tenantController.js';
const tenantRouter = Router();

// Create a new tenant along with user
tenantRouter.post('/', createTenant);

// Get Tenants
tenantRouter.get('/', getTenants);

// Get single Tenant
tenantRouter.get('/:tenantId', getTenants);

// Update tenant
tenantRouter.put('/:tenantId', getTenants);

// Delete Tenant
tenantRouter.delete('/:tenantId', getTenants);

export default tenantRouter;