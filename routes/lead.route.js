import { Router } from 'express';
import { createLead, getLeads, getLeadById, updateLead, deleteLead, updateLeadStatus } from '../controllers/leadController.js';
const leadRouter = Router();

// Create a new lead (manual upload)
leadRouter.post('/', createLead);
// Get all leads
leadRouter.get('/', getLeads);
// Get single lead
leadRouter.get('/:leadId', getLeadById);
// Update lead details
leadRouter.put('/:leadId', updateLead);
// Delete lead
leadRouter.delete('/:leadId', deleteLead);
// Update lead status only
leadRouter.patch('/:leadId/status', updateLeadStatus);

export default leadRouter;