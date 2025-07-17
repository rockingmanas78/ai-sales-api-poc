// src/bulkEmailService.js
import { PrismaClient, EmailStatus } from "@prisma/client";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export const prisma = new PrismaClient();
export const sesClient = new SESClient({ region: process.env.AWS_REGION });

// how many windows per hour you split the rate into
const WINDOWS_PER_HOUR = 6;   // e.g. 6 × 10-minute windows

/**
 * POST /api/bulk-send
 */
export async function createBulkEmailJob(req, res, next) {
  try {
    const { tenantId, templateId, leadIds, rateLimit } = req.body;
    if (!tenantId || !templateId || !Array.isArray(leadIds) || !rateLimit) {
      return res.status(400).json({ error: "tenantId, templateId, leadIds[], rateLimit required" });
    }

    // 1) verify tenant & template
    const [tenant, template] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } }),
      prisma.emailTemplate.findFirst({ where: { id: templateId, tenantId, deletedAt: null } })
    ]);
    if (!tenant)   return res.status(404).json({ error: "Tenant not found" });
    if (!template) return res.status(404).json({ error: "Template not found" });

    // 2) verify leads
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, tenantId, deletedAt: null }
    });
    if (leads.length !== leadIds.length) {
      return res.status(400).json({ error: "Some leads missing / invalid", found: leads.length });
    }

    // 3) create job + leads
    const job = await prisma.bulkEmailJob.create({
      data: {
        tenantId,
        templateId,
        rateLimit,
        nextProcessTime: new Date(),      // start immediately
        jobLeads: { create: leadIds.map(id => ({ leadId: id })) },
      },
      include: { jobLeads: true },
    });

    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/jobs/:tenantId
 */
export async function getBulkEmailJobs(req, res, next) {
  try {
    const { tenantId } = req.params;
    const jobs = await prisma.bulkEmailJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    res.json(jobs);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/jobs/:jobId
 */
export async function getBulkEmailJobById(req, res, next) {
  try {
    const { jobId } = req.params;
    const { tenantId } = req.query;
    const job = await prisma.bulkEmailJob.findFirst({
      where: { id: jobId, tenantId },
      include: { jobLeads: { include: { lead: true } } }
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/jobs/:jobId/pause
 */
export async function pauseBulkEmailJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const { tenantId } = req.body;
    const job = await prisma.bulkEmailJob.findFirst({
      where: { id: jobId, tenantId, status: { in: ["QUEUED", "PROCESSING"] } }
    });
    if (!job) return res.status(404).json({ error: "Active job not found" });
    const updated = await prisma.bulkEmailJob.update({
      where: { id: jobId },
      data: { status: "PAUSED" }
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/jobs/:jobId/resume
 */
export async function resumeBulkEmailJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const { tenantId } = req.body;
    const job = await prisma.bulkEmailJob.findFirst({
      where: { id: jobId, tenantId, status: "PAUSED" }
    });
    if (!job) return res.status(404).json({ error: "Paused job not found" });
    const updated = await prisma.bulkEmailJob.update({
      where: { id: jobId },
      data: { status: "QUEUED", nextProcessTime: new Date() }
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * Worker loop: run every minute, pick up any job whose nextProcessTime ≤ now,
 * process a batch (rateLimit / WINDOWS_PER_HOUR leads), then schedule nextProcessTime.
 */
export async function processNextBatch() {
  const now = new Date();
  const dueJobs = await prisma.bulkEmailJob.findMany({
    where: {
      status: { in: ["QUEUED", "PROCESSING"] },
      nextProcessTime: { lte: now }
    }
  });

  for (const job of dueJobs) {
    // 1) mark processing
    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING" }
    });

    // 2) compute batch size and pull leads
    const batchSize = Math.ceil(job.rateLimit / WINDOWS_PER_HOUR);
    const leadsToProcess = await prisma.bulkEmailJobLead.findMany({
      where: { jobId: job.id, status: "QUEUED" },
      include: { lead: true },
      take: batchSize
    });

    // 3) send each email
    for (const jl of leadsToProcess) {
      const { lead } = jl;
      try {
        // simple variable replace
        let html = job.template.bodyHtml
          .replace(/\{\{name\}\}/g, lead.contactName)
          .replace(/\{\{company\}\}/g, lead.companyName);
        const cmd = new SendEmailCommand({
          Destination: { ToAddresses: [lead.contactEmail] },
          Message: {
            Subject: { Charset: "UTF-8", Data: job.template.subject },
            Body: { Html: { Charset: "UTF-8", Data: html } }
          },
          Source: job.template.from
        });
        await sesClient.send(cmd);

        // success→ update status
        await prisma.bulkEmailJobLead.update({
          where: { id: jl.id },
          data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } }
        });
        await prisma.emailLog.create({
          data: {
            tenantId: job.tenantId,
            campaignId: job.campaignId,
            leadId: lead.id,
            status: "SENT",
            sentAt: new Date()
          }
        });
      } catch (err) {
        // failure→ increment attempts, mark FAILED
        await prisma.bulkEmailJobLead.update({
          where: { id: jl.id },
          data: { status: "FAILED", attempts: { increment: 1 } }
        });
      }
    }

    // 4) schedule next run: push job back into QUEUED with updated nextProcessTime
    const next = new Date();
    next.setMinutes(next.getMinutes() + Math.floor(60 / WINDOWS_PER_HOUR));
    const sentCount = await prisma.bulkEmailJobLead.count({
      where: { jobId: job.id, status: "SENT" }
    });

    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data: {
        status: leadsToProcess.length === 0 ? "COMPLETED" : "QUEUED",
        progress: sentCount,
        nextProcessTime: next
      }
    });
  }
}