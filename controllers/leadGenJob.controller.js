import axios from 'axios';
import { PrismaClient, LeadStatus } from '@prisma/client';
import { capCheck } from '../utils/capGuard.js';
import { getCapFromPlanVersion } from '../utils/getCapFromPlanVersion.js';

const prisma = new PrismaClient();
const AI_ENDPOINT = 'https://lead-generation-production-d101.up.railway.app/api';

export const searchAndExtract = async (req, res) => {
  try {
    const { tenantId, prompt, num_results = 1, offset = 0 } = req.body;

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
      `${AI_ENDPOINT}/extract/search`,
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
    // const createPromises = data.results.map(item => {
    //   const sr = item.search_result;
    //   const ci = item.contact_info;
    //   const contactEmail = ci.emails?.[0] ?? '';
    //   const contactPhone = ci.phones?.[0] ?? '';
    //   const metadata = {
    //     snippet: sr.snippet,
    //     link: sr.link,
    //     raw_contact_info: ci
    //   };

    //   return prisma.lead.create({
    //     data: {
    //       tenantId,
    //       companyName: sr.title,
    //       contactEmail,
    //       contactName: ci.company_name || '',
    //       contactPhone,
    //       status: LeadStatus.FOLLOW_UP,
    //       confidence: sr.rank > 0 ? 1 / sr.rank : null,
    //       metadata
    //     }
    //   });
    // });

    // await them all in parallel
    // const createdLeads = await Promise.all(createPromises);

    return res.status(201).json(data);
  } catch (err) {
    console.log("err", err);
    console.error('searchAndExtract error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSearchJobStatus = async (req, res) => {
  try {
    const { tenantId, job_id } = req.query;
    if (!tenantId || !job_id) {
      return res.status(400).json({ error: 'tenantId and job_id are required' });
    }

    // 1. Verify tenant exists & not soft-deleted
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null }
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // 2. Forward the incoming bearer token
    const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    // 3. Fetch the job status/results from the AI service
    const statusUrl = `${AI_ENDPOINT}/extract/get_job_update?job_id=${job_id}`;
    console.log(statusUrl);
    const { data } = await axios.get(statusUrl, {
      headers: {
        Authorization: incomingAuth,
        'Content-Type': 'application/json',
      }
    });

    console.log(data);

    // 4. Return the raw AI‐service payload to your client
    return res.status(200).json(data);

  } catch (err) {
    console.error('getSearchJobStatus error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

