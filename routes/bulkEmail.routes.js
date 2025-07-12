import { Router } from "express";
import {
  createBulkEmailJob,
  getBulkEmailJobs,
  getBulkEmailJobById,
  pauseBulkEmailJob,
  resumeBulkEmailJob
} from "../controllers/bulkEmail.controller.js";

import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";

const router = Router();
router.post("/bulk-send",verifyToken(), authorize('manage_emails'), createBulkEmailJob);
router.get("/jobs/:jobId",verifyToken(),authorize('view_emails'), getBulkEmailJobById);
router.get("/jobs/:tenantId",verifyToken(),authorize('view_emails'), getBulkEmailJobs);
router.post("/jobs/:jobId/pause",verifyToken(),authorize('manage_emails'), pauseBulkEmailJob);
router.post("/jobs/:jobId/resume",verifyToken(),authorize('manage_emails'), resumeBulkEmailJob);
export default router;

// import { Router } from "express";
// import { createBulkEmailJob, getBulkEmailJobById } from "../controllers/bullEmail.controller.js";

// const router = Router();

// router.post("/", createBulkEmailJob);
// router.get("/:jobId", getBulkEmailJobById);

// export default router;