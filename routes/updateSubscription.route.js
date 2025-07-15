import express from "express";
import { updateSubscription, verifyPhonePePaymentStatus } from "../controllers/subscription.controller.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";

const router = express.Router();

router.post("/update", verifyToken(), authorize("manage_tenant"), updateSubscription);
router.get("/verify-status/:orderId", verifyToken(), authorize("manage_tenant"), verifyPhonePePaymentStatus);

export default router;
