import express from "express";
import { handleSnsEvent } from "../controllers/sns.controller.js";
import bodyParser from "body-parser";

const router = express.Router();

// Use raw parser for SNS to avoid parsing issues
router.post(
  "/aws/sns-events",
  bodyParser.raw({ type: "application/json" }),
  handleSnsEvent
);

export default router;
