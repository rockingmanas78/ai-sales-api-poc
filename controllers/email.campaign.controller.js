import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Create Campaign
export const createCampaign = async (req, res) => {
  try {
    const { tenantId, templateId, scheduledAt } = req.body;

    if (!tenantId || !templateId) {
      return res.status(400).json({ error: 'tenantId and templateId are required' });
    }

    // Check if tenant exists and is not soft-deleted (assuming soft delete uses deletedAt)
    const tenantExists = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        deletedAt: null,
      },
    });

    if (!tenantExists) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Check if template exists, belongs to tenant, and is not soft-deleted
    const templateExists = await prisma.emailTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!templateExists) {
      return res.status(404).json({ error: 'Template not found or does not belong to tenant' });
    }

    // Check if campaign with same tenantId, templateId, and scheduledAt already exists
    const existingCampaign = await prisma.emailCampaign.findFirst({
      where: {
        tenantId,
        templateId,
        scheduledAt,
      },
    });

    if (existingCampaign) {
      return res.status(409).json({ error: 'Campaign is already scheduled with the same tenant, template, and scheduled time' });
    }

    // Create the campaign after validations
    const campaign = await prisma.emailCampaign.create({
      data: {
        tenantId,
        templateId,
        scheduledAt,
      },
    });

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};



// Get All Campaigns for a Tenant
export const getCampaigns = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in query' });
    }

    const campaigns = await prisma.emailCampaign.findMany({
      where: { tenantId },
      include: {
        template: true,
        logs: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get Single Campaign by ID and Tenant
export const getCampaignById = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const  tenantId  = req.query.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in body' });
    }

    const campaign = await prisma.emailCampaign.findFirst({
      where: {
        id: campaignId,
        tenantId,
      },
      include: {
        template: true,
        logs: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found or does not belong to tenant' });
    }

    res.json(campaign);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update Campaign (if belongs to tenant)
export const updateCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { tenantId, ...updates } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in body' });
    }

    const existing = await prisma.emailCampaign.findFirst({
      where: {
        id: campaignId,
        tenantId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found or does not belong to tenant' });
    }

    const updated = await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: updates,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete Campaign (hard delete)
export const deleteCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const  tenantId  = req.query.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in body' });
    }

    const existing = await prisma.emailCampaign.findFirst({
      where: {
        id: campaignId,
        tenantId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Campaign not found or does not belong to tenant' });
    }

    await prisma.emailCampaign.delete({
      where: { id: campaignId },
    });

    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
