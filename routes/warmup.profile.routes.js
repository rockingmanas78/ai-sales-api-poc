import express from "express";
// import { requireAuth } from "../middlewares/auth.middleware.js"; // use your auth
import {
  createWarmupProfile,
  listWarmupProfiles,
  updateWarmupProfile,
  getWarmupStats,
} from "../controllers/warmup.profile.controller.js";

const router = express.Router();

/**
 * Tenant-auth routes
 */
router.post("/create",  createWarmupProfile);
router.get("/list", listWarmupProfiles);
router.patch("/update/:id", updateWarmupProfile);
router.get("/stats",  getWarmupStats);

export default router;
