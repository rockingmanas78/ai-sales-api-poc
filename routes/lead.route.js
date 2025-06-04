import { Router } from 'express';
import { createLead, getTenantLeads, getLeadById, updateLead, deleteLead, updateLeadStatus,getDashboardLeads } from '../controllers/lead.controller.js';
const leadRouter = Router();

// Create a new lead (manual upload)
leadRouter.post('/', createLead);
// Get all leads
leadRouter.get('/tenant/:tenantId', getTenantLeads);
// Get single lead
leadRouter.get('/lead/:leadId', getLeadById);
// Update lead details
leadRouter.put('/:leadId', updateLead);
// Delete lead
leadRouter.delete('/:leadId', deleteLead);
// Update lead status only
leadRouter.patch('/:leadId/status', updateLeadStatus);

//dashboard leads
leadRouter.get('/dashboard/leads', getDashboardLeads);

export default leadRouter;