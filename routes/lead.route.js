import { Router } from 'express';
import { createLead, getTenantLeads, getLeadById, updateLead, deleteLead, updateLeadStatus,getDashboardLeads,bulkDeleteLeads, bulkUpdateLeadStatus} from '../controllers/lead.controller.js';
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';
const leadRouter = Router();

// leadRouter.use(verifyToken);

// Create a new lead (manual upload)
leadRouter.post('/', verifyToken, createLead);
// Get all leads
leadRouter.get('/tenant',verifyToken, authorize('manage_leads'), getTenantLeads);
// Get single lead
leadRouter.get('/lead/:leadId',verifyToken, authorize('manage_leads'), getLeadById);
// Update lead details
leadRouter.put('/:leadId',verifyToken, updateLead);
// Delete lead
leadRouter.delete('/:leadId',verifyToken, deleteLead);
// Update lead status only
leadRouter.patch('/:leadId/status',verifyToken, updateLeadStatus);

//dashboard leads
leadRouter.get('/dashboard/leads',verifyToken, getDashboardLeads);
leadRouter.post('/leads/bulk-delete',verifyToken, bulkDeleteLeads);
leadRouter.patch('/leads/bulk-status',verifyToken, bulkUpdateLeadStatus);

export default leadRouter;