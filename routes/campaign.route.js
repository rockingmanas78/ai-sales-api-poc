import { Router } from 'express';
import { createCampaign, getCampaigns, getCampaignById, updateCampaign, deleteCampaign,getCampaignDashboard } from '../controllers/email.campaign.controller.js';
const campaignRouter = Router();

// Create a new campaign
campaignRouter.post('/create', createCampaign);
// Get all campaigns
campaignRouter.get('/tenant/:tenantId', getCampaigns);
// Get single campaign
campaignRouter.get('/get/:campaignId', getCampaignById);
// Update campaign
campaignRouter.put('/update/:campaignId', updateCampaign);
// Delete campaign
campaignRouter.delete('/delete/:campaignId', deleteCampaign);
// Campaign Dashboard data

campaignRouter.get('/campaign/dashboard/:tenantId',getCampaignDashboard);
export default campaignRouter;