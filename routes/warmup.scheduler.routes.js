import express from "express";
import {
  runWarmupSchedulerNow,
  runWarmupSenderNow,
} from "../jobs/warmup.Scheduler.js";

const router = express.Router();
router.post("/jobs", runWarmupSchedulerNow);
router.post("/jobs/sender", runWarmupSenderNow);

export default router;