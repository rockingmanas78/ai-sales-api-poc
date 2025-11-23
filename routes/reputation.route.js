import {
  getTenantReputation,
  getTenantSpamRate,
} from "../controllers/reputation.controller.js";
import express from "express";

const router = express.Router();

router.get("/tenants/:tenantId/reputation", getTenantReputation);
router.get("/tenants/:tenantId/spam-rate", getTenantSpamRate);

export default router;
