import { Router } from 'express';
import { createTemplate, getTenantTemplates, getTemplateById, updateTemplate, deleteTemplate } from '../controllers/email.template.js';
const templateRouter = Router();

import verifyToken from "../middlewares/verifyToken.js";
import authorize from '../middlewares/rbac.js';

// Create a new email template
templateRouter.post('/create', verifyToken(),authorize('manage_templates'), createTemplate);
// Get all templates
templateRouter.get('/tenant/:tenantId',verifyToken(), authorize ('view_templates') ,getTenantTemplates);
// Get single template
templateRouter.get('/template/:templateId',verifyToken(), authorize ('view_templates'),getTemplateById);
// Update template
templateRouter.put('/update/:templateId',verifyToken(), authorize ('manage_templates'),updateTemplate);
// Delete template
templateRouter.delete('/delete/:templateId',verifyToken(), authorize ('manage_templates'),deleteTemplate);

export default templateRouter;