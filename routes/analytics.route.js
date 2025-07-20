import express from 'express';
import { getAnalyticsOverview, getViewUsage } from '../controllers/analytics.controller.js';
import verifyToken from '../middlewares/verifyToken.js';


const router = express.Router();

router.get('/overview', verifyToken(), getAnalyticsOverview);
router.get('/view-usage', verifyToken() , getViewUsage );

export default router;
