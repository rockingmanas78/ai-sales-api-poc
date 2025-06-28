import express from "express";
//import auth from "../middleware/auth.js";
import { getPricing } from "../controllers/pricing.controller.js";

const router = express.Router();
//auth.optional
router.get("/pricing", getPricing);

export default router;
