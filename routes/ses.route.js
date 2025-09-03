import express from "express";
import {
  onboardDomain,
  onboardEmail,
  checkVerificationStatus,
  sendTrackedEmail,
  listIdentities,
  checkSubdomainStatus,
  onboardSubdomain,
  inboundWebhook,
} from "../controllers/ses.controller.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import { spamScoreController } from "../controllers/email.controller.js";

const router = express.Router();

router.post(
  "/onboard-domain",
  verifyToken(),
  authorize("manage_emails"),
  onboardDomain
);
router.post(
  "/onboard-email",
  verifyToken(),
  authorize("manage_emails"),
  onboardEmail
);
router.post(
  "/verify-status",
  verifyToken(),
  authorize("manage_emails"),
  checkVerificationStatus
);
router.post(
  "/onboard-subdomain",
  verifyToken(),
  authorize("manage_emails"),
  onboardSubdomain
);
router.get(
  "/subdomain-status",
  verifyToken(),
  authorize("manage_emails"),
  checkSubdomainStatus
);

// NEW: list all onboarded domains & their emails
router.get(
  "/identities",
  verifyToken(),
  authorize("view_emails"),
  listIdentities
);
router.post("/spam-score", spamScoreController);

router.post(
  "/send-email",
  verifyToken(),
  authorize("manage_emails"),
  sendTrackedEmail
);
router.post("/inbound", inboundWebhook);

export default router;
