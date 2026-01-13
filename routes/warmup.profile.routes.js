import express from "express";
// import { requireAuth } from "../middlewares/auth.middleware.js"; // use your auth
import {
  createWarmupProfile,
  listWarmupProfiles,
  updateWarmupProfile,
  getWarmupStats,
} from "../controllers/warmup.profile.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();

/**
 * Tenant-auth routes
 */
router.post("/create", verifyToken(), createWarmupProfile);
router.get("/list", verifyToken(), listWarmupProfiles);
router.patch("/update/:id", verifyToken(), updateWarmupProfile);
router.get("/stats", verifyToken(), getWarmupStats);

export default router;
