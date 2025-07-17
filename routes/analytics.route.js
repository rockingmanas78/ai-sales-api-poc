import express from 'express';
import { getAnalyticsOverview } from '../controllers/analytics.controller.js';
import verifyToken from '../middlewares/verifyToken.js';


const router = express.Router();

router.get('/overview', verifyToken(), getAnalyticsOverview);

export default router;
