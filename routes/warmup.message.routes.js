import express from "express";
import {
  createWarmupMessage,
  listWarmupMessages,
  updateWarmupMessage,
  deleteWarmupMessage,
} from "../controllers/warmup.message.controller.js";

// import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * Warmup Message Routes
 * (tenant-scoped)
 */

// router.use(requireAuth);

router.post("/create", createWarmupMessage);
router.get("/list", listWarmupMessages);
router.patch("/:id", updateWarmupMessage);
router.delete("/:id", deleteWarmupMessage);

export default router;
