import express from "express";
import {
  listWarmupThreads,
  getWarmupThreadById,
} from "../controllers/warmup.thread.controller.js";

// import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Tenant-auth protected routes
router.get("/threads", listWarmupThreads);
router.get("/threads/:id", getWarmupThreadById);

export default router;
