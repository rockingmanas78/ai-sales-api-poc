import { Router } from 'express';
import { createTemplate, getTemplates, getTemplateById, updateTemplate, deleteTemplate } from '../controllers/emailTemplateController.js';
const templateRouter = Router();

// Create a new email template
templateRouter.post('/', createTemplate);
// Get all templates
templateRouter.get('/', getTemplates);
// Get single template
templateRouter.get('/:templateId', getTemplateById);
// Update template
templateRouter.put('/:templateId', updateTemplate);
// Delete template
templateRouter.delete('/:templateId', deleteTemplate);

export default templateRouter;