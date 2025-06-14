import express from "express";
import { handleSnsEvent } from "../controllers/sns.controller.js";

const router = express.Router();

// SNS sends signed messages → must use raw body to preserve signature
router.post(
  "/aws/sns-events",
  express.raw({ type: "application/json" }),
  handleSnsEvent
);

export default router;
