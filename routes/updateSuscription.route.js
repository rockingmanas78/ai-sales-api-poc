import express from "express";
//import auth from "../middleware/auth.js";
import { updateSubscription } from "../controllers/updateSuscription.js";

const router = express.Router();
//auth.optional
router.patch("/update",updateSubscription);

export default router;
