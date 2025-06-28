import { Router } from "express";
import {
  createBulkEmailJob,
  getBulkEmailJobs,
  getBulkEmailJobById,
  pauseBulkEmailJob,
  resumeBulkEmailJob
} from "../controllers/bullEmail.controller.js";

const router = Router();
router.post("/bulk-send", createBulkEmailJob);
router.get("/jobs/:tenantId", getBulkEmailJobs);
router.get("/jobs/:jobId", getBulkEmailJobById);
router.post("/jobs/:jobId/pause", pauseBulkEmailJob);
router.post("/jobs/:jobId/resume", resumeBulkEmailJob);
export default router;

// import { Router } from "express";
// import { createBulkEmailJob, getBulkEmailJobById } from "../controllers/bullEmail.controller.js";

// const router = Router();

// router.post("/", createBulkEmailJob);
// router.get("/:jobId", getBulkEmailJobById);

// export default router;