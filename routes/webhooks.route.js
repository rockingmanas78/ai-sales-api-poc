import Router from "express";
import express from "express";
import { handler } from "../services/webhook.service.js";

const router = express.Router();

router.post("/", handler);

export default router;
