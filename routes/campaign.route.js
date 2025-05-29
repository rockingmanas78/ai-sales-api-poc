import { Router } from 'express';
import { createCampaign, getCampaigns, getCampaignById, updateCampaign, deleteCampaign } from '../controllers/campaignController.js';
const campaignRouter = Router();

// Create a new campaign
campaignRouter.post('/', createCampaign);
// Get all campaigns
campaignRouter.get('/', getCampaigns);
// Get single campaign
campaignRouter.get('/:campaignId', getCampaignById);
// Update campaign
campaignRouter.put('/:campaignId', updateCampaign);
// Delete campaign
campaignRouter.delete('/:campaignId', deleteCampaign);

export default campaignRouter;