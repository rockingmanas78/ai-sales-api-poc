// routes/sns.route.js
import express from "express";
import { handleSnsEvent } from "../controllers/sns.controller.js";

const router = express.Router();

// Only this route uses raw body
router.post(
  "/aws/sns-events",
  express.raw({ type: "application/json" }),
  handleSnsEvent
);

export default router;
