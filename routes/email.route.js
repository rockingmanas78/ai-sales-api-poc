import { Router } from "express";
import {
  createEmail,
  getEmails,
  sendMailViaLead,
} from "../controllers/email.controller.js";
import { MeterMetric } from "@prisma/client";
import { checkEventUsageLimits } from "../middlewares/usage.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
const router = Router();

router.post(
  "/",
  verifyToken(),
  authorize("manage_emails"),
  checkEventUsageLimits(MeterMetric.EMAILS),
  createEmail
);
router.get("/", verifyToken(), authorize("view_emails"), getEmails);
// Send email to a specific lead
router.post(
  "/lead/send",
  verifyToken(),
  authorize("manage_emails"),
  sendMailViaLead
);

export default router;
