import { Router } from 'express';
import { getEmailLogs, getEmailLogById } from '../controllers/emailLogController.js';
const logRouter = Router();

// Get all email logs
logRouter.get('/', getEmailLogs);
// Get single email log
logRouter.get('/:logId', getEmailLogById);

export default logRouter;