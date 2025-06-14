// routes/sns.route.js
import express from "express";
import { handleSnsEvent } from "../controllers/sns.controller.js";

const router = express.Router();

// Make sure to use JSON parser for SNS
router.use(express.json({ type: "application/json" }));

router.post("/aws/sns-events", handleSnsEvent);

export default router;
