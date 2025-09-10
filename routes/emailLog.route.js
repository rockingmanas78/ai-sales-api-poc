import { Router } from "express";
import {
  getEmailMessages,
  getEmailMessageById,
} from "../controllers/email.logs.controller.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";

const router = Router();

// Get all email messages for a tenant
router.get(
  "/tenant/:tenantId",
  verifyToken(),
  authorize("view_emails"),
  getEmailMessages
);

// Get a single email message by ID
router.get(
  "/message/:messageId",
  verifyToken(),
  authorize("view_emails"),
  getEmailMessageById
);

export default router;
