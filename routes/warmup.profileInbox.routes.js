import express from "express";
import {
  listWarmupProfileInboxes,
  replaceWarmupProfileInboxes,
  updateWarmupProfileInbox,
} from "../controllers/warmup.profileInbox.controller.js";

const router = express.Router();

/**
 * GET /api/warmup-profiles/:profileId/inboxes
 */
router.get("/:profileId/inboxes", listWarmupProfileInboxes);

/**
 * PUT /api/warmup-profiles/:profileId/inboxes
 * Replace mapping set
 */
router.put("/:profileId/inboxes", replaceWarmupProfileInboxes);

/**
 * PATCH /api/warmup-profiles/:profileId/inboxes/:warmupInboxId
 */
router.patch("/:profileId/inboxes/:warmupInboxId", updateWarmupProfileInbox);

export default router;
