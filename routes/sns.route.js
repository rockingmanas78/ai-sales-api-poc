import express from 'express';
import { handleSnsEvent } from '../controllers/sns.controller.js';

const router = express.Router();

router.post('/aws/sns-events', handleSnsEvent); // This matches /aws/sns-events from app.js

export default router;
