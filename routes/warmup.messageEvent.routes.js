import express from "express";
import {
  listWarmupMessageEvents,
  getWarmupMessageEventById,
  getDeliverabilityReportForWarmupProfile,
} from "../controllers/warmup.messageEvent.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

// import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Tenant-auth protected
router.get("/message-events", listWarmupMessageEvents);
router.get("/message-events/:id", getWarmupMessageEventById);

router.get("/profiles/:warmupProfileId/deliverability-report", verifyToken(), getDeliverabilityReportForWarmupProfile);


export default router;
