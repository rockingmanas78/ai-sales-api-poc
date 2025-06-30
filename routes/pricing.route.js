import express from "express";
//import auth from "../middleware/auth.js";
import { getPricing } from "../controllers/pricing.controller.js";
import {detectZone} from '../middlewares/geo-detect.js'
const router = express.Router();
//auth.optional
router.get("/pricing",detectZone, getPricing);

export default router;
