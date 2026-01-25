import express from "express";
import {
  listWarmupInboxes,
  createWarmupInbox,
  updateWarmupInbox,
  onboardWarmupInbox,
  getWarmupInboxAvailability,
} from "../controllers/warmup.inbox.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();

/**
 * GET /api/warmup-inboxes
 * List active warmup inboxes
 */
router.get("/", listWarmupInboxes);

/**
 * NEW: availability (count only, no emails)
 * GET /api/warmup/inbox/availability
 */
router.get("/availability", verifyToken(), getWarmupInboxAvailability);

/** Do not use this, use onboard route instead
 * POST /api/warmup-inboxes
 * Create a new warmup inbox (ADMIN / SYSTEM only)
 */
router.post("/create", createWarmupInbox);

// The new "One-Shot" route
router.post("/onboard", onboardWarmupInbox);

/**
 * PATCH /api/warmup-inboxes/:id
 * Update warmup inbox (status, provider, etc.)
 */
router.patch("/:id", updateWarmupInbox);

export default router;
