import { Router } from "express";
import {
  getSearchJobStatus,
  searchAndExtract,
  getJobsByTenant,
} from "../controllers/leadGenJob.controller.js";
import { MeterMetric } from "@prisma/client"; // 1. Import the enum

const router = Router();
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
// 1. Import the usage limit middleware
import { checkEventUsageLimits } from "../middlewares/usage.js";

// POST /api/lead-jobs/search_and_extract
router.post("/search_and_extract", verifyToken(), authorize("manage_leads"),
  // 2. Add the middleware here to check the 'JOB' metric
  checkEventUsageLimits(MeterMetric.JOB),
  searchAndExtract
);

// GET /api/lead-jobs/status
router.get("/status", verifyToken(), //authorize("manage_leads"), 
getSearchJobStatus
);

// GET /api/lead-jobs/
router.get("/", verifyToken(), authorize("manage_leads"), getJobsByTenant);

export default router;

// import { Router } from "express";
// import {
//   getSearchJobStatus,
//   searchAndExtract,
//   getJobsByTenant, // <-- Add it here
// } from "../controllers/leadGenJob.controller.js";
// const router = Router();
// import verifyToken from "../middlewares/verifyToken.js";
// import authorize from "../middlewares/rbac.js";

// // POST /api/lead-jobs/search_and_extract
// router.post(
//   "/search_and_extract",
//   verifyToken(),
//   authorize("manage_leads"),
//   searchAndExtract
// );

// // GET /api/lead-jobs/status
// router.get(
//   "/status",
//   verifyToken(),
//   authorize("manage_leads"),
//   getSearchJobStatus
// );

// // GET /api/lead-jobs/?tenantId=...
// router.get("/", verifyToken(), authorize("manage_leads"), getJobsByTenant);

// export default router;
