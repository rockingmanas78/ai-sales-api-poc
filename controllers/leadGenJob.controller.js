import axios from 'axios';
import { PrismaClient, LeadStatus } from '@prisma/client';
import { capCheck } from '../utils/capGuard.js';
import { getCapFromPlanVersion } from '../utils/getCapFromPlanVersion.js';

const prisma = new PrismaClient();
const AI_ENDPOINT = 'https://lead-generation-pdh3.onrender.com/api/extract/search';

export const searchAndExtract = async (req, res) => {
  try {
    const { tenantId, prompt, num_results = 6, offset = 0 } = req.body;

    if (!tenantId || !prompt) {
      return res.status(400).json({ error: 'tenantId and prompt are required' });
    }

    // 1. Verify tenant exists & not soft-deleted
    // verify tenant exists & not soft-deleted
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null }
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // call the AI team API
     // grab the incoming token (e.g. "Bearer abc123")
    const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    // call the AI team API, forwarding the token
    const { data } = await axios.post(
      AI_ENDPOINT,
      { prompt, num_results, offset },
      {
        headers: {
          Authorization: incomingAuth,
          'Content-Type': 'application/json',
        }
      }
    );
    console.log('data is ', data);

    // map each result to a prisma.create promise
    const createPromises = data.results.map(item => {
      const sr = item.search_result;
      const ci = item.contact_info;
      const contactEmail = ci.emails?.[0] ?? '';
      const contactPhone = ci.phones?.[0] ?? '';
      const metadata = {
        snippet: sr.snippet,
        link: sr.link,
        raw_contact_info: ci
      };

      return prisma.lead.create({
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
    });

    // await them all in parallel
    const createdLeads = await Promise.all(createPromises);

    return res.status(201).json(createdLeads);
  } catch (err) {
    console.log("err", err);
    console.error('searchAndExtract error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

