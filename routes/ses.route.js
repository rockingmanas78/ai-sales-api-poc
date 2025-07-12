import express from 'express';
import { onboardDomain,onboardEmail,checkVerificationStatus,sendTrackedEmail, listIdentities } from '../controllers/ses.controller.js';
import verifyToken from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

router.post('/onboard-domain', verifyToken(), authorize('manage_emails'), onboardDomain);
router.post('/onboard-email', verifyToken(), authorize('manage_emails'), onboardEmail);
router.post('/verify-status', verifyToken(), authorize('manage_emails'), checkVerificationStatus);

// NEW: list all onboarded domains & their emails
router.get('/identities', verifyToken(), authorize('view_emails'), listIdentities);

router.post('/send-email', verifyToken(), authorize('manage_emails'), sendTrackedEmail);

export default router;



