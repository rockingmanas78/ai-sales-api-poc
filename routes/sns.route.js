// routes/sns.route.js
import express from "express";
import { handleSnsEvent } from "../controllers/sns.controller.js";

const router = express.Router();

// Only this route uses raw body
router.post(
  "/aws/sns-events",
  express.text({ type: ["text/plain", "application/json"] }),
  handleSnsEvent
);

export default router;
