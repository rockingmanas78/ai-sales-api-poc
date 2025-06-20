import express from 'express';
import { onboardDomain,onboardEmail,checkVerificationStatus,sendTrackedEmail } from '../controllers/ses.controller.js';

const router = express.Router();

// POST /api/email/send-email
router.post('/onboard-domain',onboardDomain);
router.post('/onboard-email',onboardEmail);
router.post('/verify-status',checkVerificationStatus);
router.post("/send-email", sendTrackedEmail);
export default router;
