import express from "express";
import {
    autoAssignProfileInboxes,
  listWarmupProfileInboxes,
  replaceWarmupProfileInboxes,
  updateWarmupProfileInbox,
} from "../controllers/warmup.profileInbox.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();

/**
 * GET /api/warmup-profiles/:profileId/inboxes
 */
router.get("/:profileId/inboxes", verifyToken(), listWarmupProfileInboxes);

/**
 * PUT /api/warmup-profiles/:profileId/inboxes
 * Replace mapping set
 */
router.put("/:profileId/inboxes", verifyToken(), replaceWarmupProfileInboxes);

router.post("/:profileId/inboxes/auto", verifyToken(), autoAssignProfileInboxes);

/**
 * PATCH /api/warmup-profiles/:profileId/inboxes/:warmupInboxId
 */
router.patch("/:profileId/inboxes/:warmupInboxId", verifyToken(), updateWarmupProfileInbox);

export default router;
