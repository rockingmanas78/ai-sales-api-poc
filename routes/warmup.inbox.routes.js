import express from "express";
import {
  listWarmupInboxes,
  createWarmupInbox,
  updateWarmupInbox,
} from "../controllers/warmup.inbox.controller.js";

const router = express.Router();

/**
 * GET /api/warmup-inboxes
 * List active warmup inboxes
 */
router.get("/", listWarmupInboxes);

/**
 * POST /api/warmup-inboxes
 * Create a new warmup inbox (ADMIN / SYSTEM only)
 */
router.post("/", createWarmupInbox);

/**
 * PATCH /api/warmup-inboxes/:id
 * Update warmup inbox (status, provider, etc.)
 */
router.patch("/:id", updateWarmupInbox);

export default router;
