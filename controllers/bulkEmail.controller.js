// src/bulkEmailService.js
import { PrismaClient, EmailStatus } from "@prisma/client";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import mustache from 'mustache';
import { sendEmail } from "../services/ses.service.js";

export const prisma = new PrismaClient();
export const sesClient = new SESClient({ region: process.env.AWS_REGION });

// how many windows per hour you split the rate into
const WINDOWS_PER_HOUR = 6;   // e.g. 6 × 10-minute windows
const MAX_ATTEMPTS = Number(process.env.MAX_EMAIL_ATTEMPTS || 3);
const WINDOW_MS = 60000;

/**
 * POST /api/bulk-send
 */
// export async function createBulkEmailJob(req, res, next) {
//   try {
//     const { tenantId, templateId, leadIds, rateLimit } = req.body;

//     // 1. validate
//     if (!tenantId || !templateId || !Array.isArray(leadIds) || !rateLimit) {
//       return res.status(400).json({ error: "tenantId, templateId, leadIds[], rateLimit required" });
//     }

//     // 2) verify tenant & template
//     const [tenant, template, leads] = await Promise.all([
//       prisma.tenant.findUnique({ where: { id: tenantId, deletedAt: null } }),
//       prisma.emailTemplate.findFirst({ where: { id: templateId, tenantId , deletedAt: null } }),
//       prisma.lead.findMany({ where: { id: { in: leadIds }, tenantId, deletedAt: null } })
//     ]);
//     if (!tenant)   return res.status(404).json({ error: "Tenant not found" });
//     if (!template) return res.status(404).json({ error: "Template not found" });
//     if (leads.length !== leadIds.length)
//       return res.status(400).json({ error: "Some leads invalid or belong to another tenant" });

//     // // 3) create job + leads
//     // const job = await prisma.bulkEmailJob.create({
//     //   data: {
//     //     tenantId,
//     //     templateId,
//     //     rateLimit,
//     //     nextProcessTime: new Date(),      // start immediately
//     //     jobLeads: { create: leadIds.map(id => ({ leadId: id })) },
//     //   },
//     //   include: { jobLeads: true },
//     // });

//     // 4. create job + junction rows in ONE tx
//     const job = await prisma.$transaction(async tx => {
//       const j = await tx.bulkEmailJob.create({
//         data: {
//           tenantId,
//           templateId,
//           rateLimit,
//           total: leadIds.length,
//           nextProcessTime: new Date(),          // start now
//           jobLeads: { create: leadIds.map(id => ({ leadId: id })) }
//         },
//         include: { jobLeads: true }
//       });
//       // optional: mark parent campaign ACTIVE if provided
//       return j;
//     });

//     res.status(201).json(job);
//   } catch (err) {
//     next(err);
//   }
// }

export async function createBulkEmailJob(req, res, next) {
  try {
    const { tenantId, templateId, leadIds, rateLimit, campaignId } = req.body;

    // 1. Basic validation
    if (!tenantId || !templateId || !Array.isArray(leadIds) || !rateLimit) {
      return res
        .status(400)
        .json({ error: "tenantId, templateId, leadIds[], rateLimit required" });
    }

    // 2. Verify tenant, template, and leads
    const [tenant, template, leads] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId, deletedAt: null } }),
      prisma.emailTemplate.findFirst({ where: { id: templateId, tenantId, deletedAt: null } }),
      prisma.lead.findMany({
        where: { id: { in: leadIds }, tenantId, deletedAt: null },
      }),
    ]);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (leads.length !== leadIds.length) {
      return res.status(400).json({
        error: "Some leads invalid or belong to another tenant",
      });
    }

    // 3. Optionally create a campaign if none was supplied
    let campaignIdToUse = campaignId;
    if (!campaignId) {
      const campaign = await prisma.emailCampaign.create({
        data: {
          tenantId,
          templateId,
          status: "ACTIVE",       // or DRAFT if you prefer
          scheduledAt: new Date(),// or null if you schedule later
        },
      });
      campaignIdToUse = campaign.id;
    }

    // 4. Create the BulkEmailJob, linking the campaignId
    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.bulkEmailJob.create({
        data: {
          tenantId,
          templateId,
          campaignId: campaignIdToUse,  // ← attach here
          rateLimit,
          total: leadIds.length,
          nextProcessTime: new Date(),
          jobLeads: {
            create: leadIds.map((id) => ({ leadId: id })),
          },
        },
        include: { jobLeads: true },
      });
      return j;
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
  console.log("Starting Next batch");
  const now = new Date();

  // ① Grab all jobs that are due, *including* their template
  const dueJobs = await prisma.bulkEmailJob.findMany({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      nextProcessTime: { lte: now }
    },
    include: { template: true }       // ← critical
  });

  console.log(dueJobs);

  for (const job of dueJobs) {
    // 1️⃣ mark PROCESSING
    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', lastProcessedAt: now }
    });

    // 2️⃣ pull next leads
    const batchSize = Math.ceil(job.rateLimit / WINDOWS_PER_HOUR);
    const leadsToProcess = await prisma.bulkEmailJobLead.findMany({
      where: { jobId: job.id, status: 'QUEUED' },
      include: { lead: true },
      take: batchSize
    });
    console.log(leadsToProcess);
    // 3️⃣ send each lead
    for (const jl of leadsToProcess) {
      const { lead } = jl;
      const vars = {
        name   : lead.contactName ?? '',
        company: lead.companyName ?? '',
        email  : (lead.contactEmail ?? [])[0] ?? '',
        ...lead
      };

      const renderedSubject = mustache.render(job.template.subject, vars);
      const renderedHtml    = mustache.render(job.template.body,    vars);
      const toEmail         = vars.email;

      try {
        await sendEmail({
          fromEmail: job.template.from,
          toEmail,
          subject : renderedSubject,
          htmlBody: renderedHtml
        });

        // success
        await prisma.bulkEmailJobLead.update({
          where: { id: jl.id },
          data : {
            status  : 'SENT',
            sentAt  : new Date(),
            attempts: { increment: 1 }
          }
        });
        await prisma.emailLog.create({
          data: {
            tenantId  : job.tenantId,
            campaignId: job.campaignId,
            leadId    : lead.id,
            status    : 'SENT',
            sentAt    : new Date()
          }
        });
      } catch (err) {
        console.error(`SES error (${toEmail})`, err);

        const updatedLead = await prisma.bulkEmailJobLead.update({
          where : { id: jl.id },
          data  : { attempts: { increment: 1 } },
          select: { attempts: true }
        });

        console.log(updatedLead);

        const retry = updatedLead.attempts < MAX_ATTEMPTS;

        await prisma.bulkEmailJobLead.update({
          where: { id: jl.id },
          data : { status: retry ? 'QUEUED' : 'FAILED' }
        });
        await prisma.emailLog.create({
          data: {
            tenantId  : job.tenantId,
            campaignId: job.campaignId,
            leadId    : lead.id,
            status    : retry ? 'QUEUED' : 'FAILED'
          }
        });
      }
    }

    // 4️⃣ figure out what’s left & schedule next window
    const stillQueued = await prisma.bulkEmailJobLead.count({
      where: { jobId: job.id, status: 'QUEUED' }
    });
    const processed   = job.total - stillQueued;

    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data : {
        progress        : processed,
        status          : stillQueued ? 'QUEUED' : 'COMPLETED',
        nextProcessTime : stillQueued ? new Date(now.getTime() + WINDOW_MS) : null,
        completedAt     : stillQueued ? null : new Date()
      }
    });

    if (job.campaignId) {
      await prisma.emailCampaign.update({
        where: { id: job.campaignId },
        data : { status: stillQueued ? 'ACTIVE' : 'COMPLETED' }
      });
    }
  }
}
