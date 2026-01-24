import express from "express";
import {
  warmupInboundWebhook,
  warmupSesSnsEventsWebhook,
} from "../controllers/warmup.webhooks.controller.js";

const router = express.Router();

router.post("/inbound", warmupInboundWebhook);
router.post("/sns-events",
  express.text({ type: ["text/plain", "application/json"], limit: "2mb" }),
  warmupSesSnsEventsWebhook);

export default router;