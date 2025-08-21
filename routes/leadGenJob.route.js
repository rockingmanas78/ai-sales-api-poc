import { Router } from "express";
import {
  getSearchJobStatus,
  searchAndExtract,
  getJobsByTenant, // <-- Add it here
} from "../controllers/leadGenJob.controller.js";
const router = Router();
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import { checkUsageLimit } from "../middlewares/usage.js";

// POST /api/lead-jobs/search_and_extract
router.post(
  "/search_and_extract",
  verifyToken(),
  checkUsageLimit("JOB"),
  authorize("manage_leads"),
  searchAndExtract
);

// GET /api/lead-jobs/status
router.get(
  "/status",
  verifyToken(),
  authorize("manage_leads"),
  getSearchJobStatus
);

// GET /api/lead-jobs/?tenantId=...
router.get("/", verifyToken(), authorize("manage_leads"), getJobsByTenant);

export default router;
