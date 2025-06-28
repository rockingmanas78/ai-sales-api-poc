import express from 'express';
import { onboardDomain,onboardEmail,checkVerificationStatus,sendTrackedEmail, listIdentities } from '../controllers/ses.controller.js';

const router = express.Router();

// POST /api/email/send-email
// router.post('/onboard-domain',onboardDomain);
// router.post('/onboard-email',onboardEmail);
// router.post('/verify-status',checkVerificationStatus);
// router.post("/send-email", sendTrackedEmail);

router.post('/onboard-domain', onboardDomain);
router.post('/onboard-email', onboardEmail);
router.post('/verify-status', checkVerificationStatus);

// NEW: list all onboarded domains & their emails
router.get('/identities', listIdentities);

router.post('/send-email', sendTrackedEmail);
export default router;
