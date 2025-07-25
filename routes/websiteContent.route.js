// routes/websiteContent.routes.js
import express from 'express';
import {
  createWebsite,
  listWebsites,
  getWebsiteById,
  updateWebsite,
  deleteWebsite
} from '../controllers/websiteContent.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

// Create new website to crawl
router.post('/', verifyToken(), authorize('manage_documents'), createWebsite);

// List all websites for the tenant
router.get('/', verifyToken(), authorize('view_documents'), listWebsites);

// Get details of a specific website crawl
router.get('/:id', verifyToken(), authorize('view_documents'), getWebsiteById);

// Update URL or reset status
router.patch('/:id', verifyToken(), authorize('manage_documents'), updateWebsite);

// Delete a website crawl
router.delete('/:id', verifyToken(), authorize('manage_documents'), deleteWebsite);

export default router;
