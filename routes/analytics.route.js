import express from "express";
import {
  getAnalyticsOverview,
  getViewUsage,
  getHealthDeliverability,
  getRemainingComponentsCount,
} from "../controllers/analytics.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();

router.get("/overview", verifyToken(), getAnalyticsOverview);
router.get("/view-usage", verifyToken(), getViewUsage);
router.get("/health-deliverability", verifyToken(), getHealthDeliverability);
router.get("/remaining_quota", verifyToken(), getRemainingComponentsCount);

export default router;
