import express from "express";
import { getPricing, getQuote } from "../controllers/pricing.controller.js";
import { detectZone } from "../middlewares/geo-detect.js";
import verifyToken from "../middlewares/verifyToken.js"; // import it

const router = express.Router();

// Pricing is public, but if token is provided, enhance personalization
router.get(
  "/pricing",
  verifyToken({ required: false }),
  detectZone,
  getPricing
);
router.post("/quote", verifyToken({ required: false }), detectZone, getQuote);

export default router;
