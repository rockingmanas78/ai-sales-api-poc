// controllers/searchAndExtract.controller.js
import axios from 'axios';
import { PrismaClient, LeadStatus } from '@prisma/client';

const prisma = new PrismaClient();
// your AI‑team endpoint
const AI_ENDPOINT = 'https://lead-generation-pdh3.onrender.com/api/extract/search';

export const searchAndExtract = async (req, res) => {
  try {
    const { tenantId, prompt, num_results = 6, offset = 0 } = req.body;
    if (!tenantId || !prompt) {
      return res.status(400).json({ error: 'tenantId and prompt are required' });
    }

    // verify tenant exists & not soft‑deleted
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null }
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // call the AI team API
    const { data } = await axios.post(AI_ENDPOINT, {
      prompt,
      num_results,
      offset
    });
    console.log('data is ',data);

    const createdLeads = [];
    for (const item of data.results) {
      const sr = item.search_result;
      const ci = item.contact_info;
      // pick first email/phone if any
      const contactEmail = ci.emails?.[0] ?? '';
      const contactPhone = ci.phones?.[0] ?? '';
      // store raw snippet+link in metadata
      const metadata = {
        snippet: sr.snippet,
        link: sr.link,
        raw_contact_info: ci
      };

      const lead = await prisma.lead.create({
        data: {
          tenantId,
          companyName: sr.title,
          contactEmail,
          contactName: ci.company_name || '',
          contactPhone,
          status: LeadStatus.FOLLOW_UP,
          confidence: sr.rank > 0 ? 1 / sr.rank : null,
          metadata
        }
      });

      createdLeads.push(lead);
    }

    return res.status(201).json(createdLeads);
  } catch (err) {
    console.log('err is ',err);
    console.error('searchAndExtract error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
