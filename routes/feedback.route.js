import express from 'express';
import {
  createFeedback,
  getAllFeedbacks,
  getFeedbackById,
  deleteFeedback,
  getFeedbackCategories,
} from '../controllers/feedback.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import { authorize } from '../middlewares/rbac.js';

const router = express.Router();

router.get('/categories', getFeedbackCategories);
router.post('/', verifyToken(), authorize('submit_feedback'), createFeedback);
router.get('/', verifyToken(), authorize('view_feedbacks'), getAllFeedbacks);
router.get('/:feedbackId', verifyToken(), authorize('view_feedbacks'), getFeedbackById);
router.delete('/:feedbackId', verifyToken(), authorize('delete_feedback'), deleteFeedback);

export default router;