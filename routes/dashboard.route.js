import express from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller.js';

const router = express.Router();

import { verifyToken } from '../middlewares/verifyToken.js';

router.get('/dashboard', verifyToken(), getDashboardStats);

export default router;
