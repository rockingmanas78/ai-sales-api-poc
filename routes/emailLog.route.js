import { Router } from 'express';
import { getEmailLogs, getEmailLogById } from '../controllers/email.logs.controller.js';
const logRouter = Router();

import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

// Get all email logs
logRouter.get('/:tenantId',verifyToken(), authorize('view_emails'), getEmailLogs);
// Get single email log
logRouter.get('/:logId',verifyToken(), authorize('view_emails'), getEmailLogById);

export default logRouter;