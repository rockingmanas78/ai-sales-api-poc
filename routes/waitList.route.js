import express from 'express';
import { createWaitListMember } from '../controllers/waitList.controller.js';

const router = express.Router();

router.post('/waitlist', createWaitListMember);

export default router;
