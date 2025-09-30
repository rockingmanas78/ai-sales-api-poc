import { Router } from "express";
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  getCampaignDashboard,
  getDetailsByConversationId,
} from "../controllers/email.campaign.controller.js";
import authorize from "../middlewares/rbac.js";
const campaignRouter = Router();

import verifyToken from "../middlewares/verifyToken.js";

// Create a new campaign
campaignRouter.post(
  "/create",
  verifyToken(),
  authorize("manage_campaigns"),
  createCampaign
);
// Get all campaigns
campaignRouter.get(
  "/tenant/:tenantId",
  verifyToken(),
  authorize("view_campaigns"),
  getCampaigns
);
// Get single campaign
campaignRouter.get(
  "/get/:campaignId",
  verifyToken(),
  authorize("view_campaigns"),
  getCampaignById
);
// Update campaign
campaignRouter.put(
  "/update/:campaignId",
  verifyToken(),
  authorize("manage_campaigns"),
  updateCampaign
);
// Delete campaign
campaignRouter.delete(
  "/delete/:campaignId",
  verifyToken(),
  authorize("manage_campaigns"),
  deleteCampaign
);
// Campaign Dashboard data
campaignRouter.get(
  "/campaign/dashboard/:tenantId",
  verifyToken(),
  authorize("view_campaigns"),
  getCampaignDashboard
);

campaignRouter.get(
  "/:conversationId",
  verifyToken(),
  authorize("view_campaigns"),
  getDetailsByConversationId
);
export default campaignRouter;
