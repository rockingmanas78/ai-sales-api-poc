// routes/conversation.routes.js
import express from "express";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import {
  getConversationMessages,
  listConversations,
} from "../controllers/conversations.controller.js";

const router = express.Router();

router.get("/", verifyToken(), authorize("view_emails"), listConversations);
router.get(
  "/:conversationId/messages",
  verifyToken(),
  authorize("view_emails"),
  getConversationMessages
);

export default router;
