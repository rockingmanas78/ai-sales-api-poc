import { Router } from 'express';
import { createEmail, getEmails } from '../controllers/email.controller.js';

const router = Router();

router.post('/', createEmail);
router.get('/', getEmails);

export default router;