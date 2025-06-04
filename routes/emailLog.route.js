import { Router } from 'express';
import { getEmailLogs, getEmailLogById } from '../controllers/email.logs.controller.js';
const logRouter = Router();

// Get all email logs
logRouter.get('/:tenantId', getEmailLogs);
// Get single email log
logRouter.get('/:logId', getEmailLogById);

export default logRouter;