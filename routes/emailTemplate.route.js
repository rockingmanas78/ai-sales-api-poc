import { Router } from 'express';
import { createTemplate, getTenantTemplates, getTemplateById, updateTemplate, deleteTemplate } from '../controllers/email.template.js';
const templateRouter = Router();

// Create a new email template
templateRouter.post('/create', createTemplate);
// Get all templates
templateRouter.get('/tenant/:tenantId', getTenantTemplates);
// Get single template
templateRouter.get('/template/:templateId', getTemplateById);
// Update template
templateRouter.put('/update/:templateId', updateTemplate);
// Delete template
templateRouter.delete('/delete/:templateId', deleteTemplate);

export default templateRouter;