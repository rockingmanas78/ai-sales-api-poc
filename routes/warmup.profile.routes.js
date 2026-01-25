import express from "express";
// import { requireAuth } from "../middlewares/auth.middleware.js"; // use your auth
import {
  createWarmupProfile,
  listWarmupProfiles,
  updateWarmupProfile,
  getWarmupStats,
  getWarmupProfileById,
  startWarmupProfile,
  pauseWarmupProfile,
  resumeWarmupProfile,
} from "../controllers/warmup.profile.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();

/**
 * Tenant-auth routes
 */
router.post("/create", verifyToken(), createWarmupProfile);
router.get("/list", verifyToken(), listWarmupProfiles);
router.patch("/update/:id", verifyToken(), updateWarmupProfile);
router.get("/:id/stats", verifyToken(), getWarmupStats);
router.get("/get/:id", verifyToken(), getWarmupProfileById);

/**
 * NEW: Start / Pause / Resume
 * Note: using POST for actions (simple + UI-friendly)
 */
router.post("/start/:profileId", verifyToken(), startWarmupProfile);
router.post("/pause/:profileId", verifyToken(), pauseWarmupProfile);
router.post("/resume/:profileId", verifyToken(), resumeWarmupProfile);

export default router;
