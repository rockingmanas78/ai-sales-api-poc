// controllers/leadController.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// CREATE Lead
export const createLead = async (req, res) => {
  try {
    const { tenantId, companyName, contactEmail, contactPhone, contactName, confidence, metadata } = req.body;

    // Validate required fields
    if (!tenantId || !companyName || !contactEmail || !contactName) {
      return res.status(400).json({ error: 'tenantId, companyName, contactEmail, and contactName are required' });
    }

    // Validate tenant exists and is not soft deleted
    const tenantExists = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        deletedAt: null,
      },
    });

    if (!tenantExists) {
      return res.status(404).json({ error: 'Tenant not found or has been deleted' });
    }

    // Create new lead
    const newLead = await prisma.lead.create({
      data: {
        tenantId,
        companyName,
        contactEmail,
        contactName,
        contactPhone,
        confidence,
        metadata,
      },
    });

    res.status(201).json(newLead);
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// GET All Leads for a Tenant (Only non-deleted)
export const getTenantLeads = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request params' });
    }

    const leads = await prisma.lead.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
    });

    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET Lead by ID (Only if it belongs to tenant and is not deleted)
export const getLeadById = async (req, res) => {
  try {
    const { leadId } = req.params;
    const  tenantId  = req.query.tenantId;

    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found or does not belong to tenant' });
    }

    res.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const getDashboardLeads = async (req, res) => {
  try {
    const  tenantId  = req.query.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    // Fetch leads filtered by status (interested, follow_up, high priority) and soft-deleted excluded
    const leads = await prisma.lead.findMany({
      where: {
        tenantId,
        status: {
          in: ['INTERESTED', 'FOLLOW_UP', 'IMMEDIATE_ACTION'],
        },
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      // take: 5,
      // select: {
      //   companyName: true,
      //   contactEmail: true,
      //   contactName: true,
      //   contactPhone: true,
      //   status: true,
      // },
    });

    // Calculate counts
    const interestedCount = leads.filter(l => l.status === 'INTERESTED').length;
    const followUpCount = leads.filter(l => l.status === 'FOLLOW_UP').length;
    const highPriorityCount = leads.filter(l => l.status === 'IMMEDIATE_ACTION').length;

    res.json({
      leads,
      stats: {
        interested: interestedCount,
        followUp: followUpCount,
        highPriority: highPriorityCount,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard leads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// UPDATE Lead (Only if belongs to tenant and not deleted)
export const updateLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { tenantId, ...updates } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingLead) {
      return res.status(404).json({ error: 'Lead not found or does not belong to tenant' });
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: updates,
    });

    res.json(updatedLead);
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// SOFT DELETE Lead
export const deleteLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { tenantId } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingLead) {
      return res.status(404).json({ error: 'Lead not found or does not belong to tenant' });
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: 'Lead soft-deleted successfully' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PATCH Lead Status (Only if not deleted)
export const updateLeadStatus = async (req, res) => {
  try {
    const { leadId } = req.params;
    const { tenantId, status } = req.body;

    const existingLead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingLead) {
      return res.status(404).json({ error: 'Lead not found or does not belong to tenant' });
    }

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { status },
    });

    res.json(updatedLead);
  } catch (error) {
    console.error('Error updating lead status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// BULK SOFT DELETE Leads
export const bulkDeleteLeads = async (req, res) => {
  try {
    const { tenantId, leadIds } = req.body;

    if (!tenantId || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'tenantId and leadIds[] are required' });
    }

    // Validate ownership of all leads
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });

    const unauthorizedLeads = leads.filter(lead => lead.tenantId !== tenantId);
    if (unauthorizedLeads.length > 0) {
      return res.status(403).json({ error: 'One or more leads do not belong to the tenant' });
    }

    // Proceed with soft-deleting authorized leads
    const result = await prisma.lead.updateMany({
      where: {
        id: { in: leadIds },
        tenantId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    res.json({ message: 'Leads soft-deleted successfully', count: result.count });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
  

export const bulkUpdateLeadStatus = async (req, res) => {
  try {
    const { tenantId, leadIds, status } = req.body;

    if (!tenantId || !Array.isArray(leadIds) || leadIds.length === 0 || !status) {
      return res.status(400).json({ error: 'tenantId, leadIds[], and status are required' });
    }

    // Validate ownership
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });

    const unauthorizedLeads = leads.filter(lead => lead.tenantId !== tenantId);
    if (unauthorizedLeads.length > 0) {
      return res.status(403).json({ error: 'One or more leads do not belong to the tenant' });
    }

    // Proceed with update
    const result = await prisma.lead.updateMany({
      where: {
        id: { in: leadIds },
        tenantId,
        deletedAt: null,
      },
      data: {
        status,
      },
    });

    res.json({ message: `Lead statuses updated to ${status}`, count: result.count });
  } catch (error) {
    console.error('Error in bulk status update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

