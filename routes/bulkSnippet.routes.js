// routes/bulkSnippet.routes.js
import express from 'express';
import {
  createSnippet,
  listSnippets,
  getSnippetById,
  updateSnippet,
  deleteSnippet
} from '../controllers/bulkSnippet.controller.js';

import { verifyToken } from '../middlewares/verifyToken.js';
import authorize from '../middlewares/rbac.js';

const router = express.Router();

// Create new snippet
router.post('/', verifyToken(), authorize('manage_documents'), createSnippet);

// List all snippets (search, pagination)
router.get('/', verifyToken(), authorize('view_documents'), listSnippets);

// Get one snippet
router.get('/:id', verifyToken(), authorize('view_documents'), getSnippetById);

// Edit snippet text
router.patch('/:id', verifyToken(), authorize('manage_documents'), updateSnippet);

// Delete snippet
router.delete('/:id', verifyToken(), authorize('manage_documents'), deleteSnippet);

export default router;
