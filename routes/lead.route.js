import { Router } from 'express';
import { createLead, getTenantLeads, getLeadById, updateLead, deleteLead, updateLeadStatus,getDashboardLeads,bulkDeleteLeads, bulkUpdateLeadStatus} from '../controllers/lead.controller.js';
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';
import multer from 'multer';
import { uploadLeadsFromCSV } from '../controllers/lead.controller.js';

const leadRouter = Router();
const upload = multer({ dest: 'uploads/' });

// Create a new lead (manual upload)
leadRouter.post('/', verifyToken(),authorize('manage_leads'), createLead);
// Get all leads
leadRouter.get('/tenant/:tenantId',verifyToken(), authorize('view_leads'), getTenantLeads);
// Get single lead
leadRouter.get('/lead/:leadId',verifyToken(), authorize('view_leads'), getLeadById);
// Update lead details
leadRouter.put('/:leadId',verifyToken(),authorize('manage_leads'), updateLead);
// Delete lead
leadRouter.delete('/:leadId',verifyToken(),authorize('manage_leads'), deleteLead);
// Update lead status only
leadRouter.patch('/:leadId/status',verifyToken(), authorize('manage_leads'), updateLeadStatus);

//dashboard leads
leadRouter.get('/dashboard/leads',verifyToken(),authorize('view_leads'), getDashboardLeads);
leadRouter.post('/leads/bulk-delete',verifyToken(),authorize('manage_leads'), bulkDeleteLeads);
leadRouter.patch('/leads/bulk-status',verifyToken(),authorize('manage_leads'), bulkUpdateLeadStatus);
//CSV to Lead Json
leadRouter.post('/upload-csv', verifyToken(), upload.single('file'), uploadLeadsFromCSV);

export default leadRouter;