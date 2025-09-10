import express from "express";
import {
  startPayment,
  cancelSubscription,
  updateSubscription,
  getSubscriptionName,
  getSubscriptionCharges,
  getPaymentStatus,
  verifyPhonePePaymentStatus,
} from "../controllers/subscription.controller.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import {} from "../controllers/subscription.controller.js";

const router = express.Router();

router.post("/start", verifyToken(), authorize("manage_tenant"), startPayment);
router.put(
  "/update",
  verifyToken(),
  authorize("manage_tenant"),
  updateSubscription
);
router.delete(
  "/cancel/:tenantId",
  verifyToken(),
  authorize("manage_tenant"),
  cancelSubscription
);
router.get(
  "/me/:tenantId",
  verifyToken(),
  authorize("manage_tenant"),
  getSubscriptionName
);
router.get(
  "/charges/:tenantId",
  verifyToken(),
  authorize("manage_tenant"),
  getSubscriptionCharges
);
router.get(
  "/payment-status/:paymentId",
  verifyToken(),
  authorize("manage_tenant"),
  getPaymentStatus
);
router.get(
  "/verify-status/:orderId",
  verifyToken(),
  authorize("manage_tenant"),
  verifyPhonePePaymentStatus
);

export default router;
