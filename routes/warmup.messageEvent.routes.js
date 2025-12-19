import express from "express";
import {
  listWarmupMessageEvents,
  getWarmupMessageEventById,
} from "../controllers/warmup.messageEvent.controller.js";

// import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Tenant-auth protected
router.get("/message-events", listWarmupMessageEvents);
router.get("/message-events/:id", getWarmupMessageEventById);

export default router;
