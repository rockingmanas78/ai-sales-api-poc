// src/bulkEmailService.js
import { PrismaClient, EmailStatus } from "@prisma/client";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import mustache from "mustache";
import { sendEmail } from "../services/ses.service.js";
import crypto from "crypto";

export const prisma = new PrismaClient();
export const sesClient = new SESClient({ region: process.env.AWS_REGION });

// how many windows per hour you split the rate into
const WINDOWS_PER_HOUR = 6; // e.g. 6 × 10-minute windows
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
      prisma.emailTemplate.findFirst({
        where: { id: templateId, tenantId, deletedAt: null },
      }),
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
          status: "ACTIVE", // or DRAFT if you prefer
          scheduledAt: new Date(), // or null if you schedule later
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
          campaignId: campaignIdToUse, // ← attach here
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
      orderBy: { createdAt: "desc" },
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
      include: { jobLeads: { include: { lead: true } } },
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
      where: { id: jobId, tenantId, status: { in: ["QUEUED", "PROCESSING"] } },
    });
    if (!job) return res.status(404).json({ error: "Active job not found" });
    const updated = await prisma.bulkEmailJob.update({
      where: { id: jobId },
      data: { status: "PAUSED" },
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
      where: { id: jobId, tenantId, status: "PAUSED" },
    });
    if (!job) return res.status(404).json({ error: "Paused job not found" });
    const updated = await prisma.bulkEmailJob.update({
      where: { id: jobId },
      data: { status: "QUEUED", nextProcessTime: new Date() },
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
  console.log("Starting next batch window");
  const now = new Date();

  const dueJobs = await prisma.bulkEmailJob.findMany({
    where: { status: { in: ["QUEUED", "PROCESSING"] }, nextProcessTime: { lte: now } },
    include: { template: true },
  });

  for (const job of dueJobs) {
    try {
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING", lastProcessedAt: now },
      });

      const perWindow = Math.max(1, Math.ceil(job.rateLimit / WINDOWS_PER_HOUR));

      const jobLeads = await prisma.bulkEmailJobLead.findMany({
        where: { jobId: job.id, status: "QUEUED" },
        include: { lead: true },
        take: perWindow,
      });

      for (const jobLead of jobLeads) {
        const lead = jobLead.lead;

        // Basic guardrails
        if (!job.template || !job.template.from) {
          console.error("Template or from address missing; marking FAILED", { jobId: job.id });
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
          continue;
        }

        const templateVars = {
          contactName: lead.contactName ?? "",
          companyName: lead.companyName ?? "",
          email: (lead.contactEmail ?? [])[0] ?? "",
          ...lead,
        };

        let renderedSubject, renderedHtml;
        try {
          renderedSubject = mustache.render(job.template.subject, templateVars);
          renderedHtml = mustache.render(job.template.body, templateVars);
        } catch (e) {
          console.error("Template render failed; marking FAILED", { leadId: lead.id, e });
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
          continue;
        }

        const toEmail = templateVars.email;
        if (!toEmail) {
          console.error("Lead has no primary email; marking FAILED", { leadId: lead.id });
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
          continue;
        }

        // Generate per-thread token (threadKey === plusToken)
        const plusToken = crypto.randomUUID();

        // Resolve verified inbound subdomain
        const inboundSubdomain = await prisma.domainIdentity.findFirst({
          where: {
            tenantId: job.tenantId,
            domainName: { startsWith: "inbound." },
            verificationStatus: "Success",
          },
          select: { domainName: true },
        });

        if (!inboundSubdomain) {
          console.error("No verified inbound subdomain for tenant; marking FAILED", { tenantId: job.tenantId });
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
          continue;
        }

        const replyToAddress = `reply+${plusToken}@${inboundSubdomain.domainName}`;

        try {
          // 1) Send first
          const sendResponse = await sendEmail({
            fromEmail: job.template.from,
            toEmail,
            subject: renderedSubject,
            htmlBody: renderedHtml,
            configurationSetName: process.env.SES_CONFIGURATION_SET,
            replyToAddresses: [replyToAddress],
            messageTags: [
              { Name: "tenantId", Value: job.tenantId },
              { Name: "replyToToken", Value: plusToken }, // standardized for events handler
              ...(job.campaignId ? [{ Name: "campaignId", Value: job.campaignId }] : []),
              { Name: "leadId", Value: lead.id },
            ],
          });

          const providerMessageId = sendResponse?.MessageId;
          if (!providerMessageId) throw new Error("SES did not return MessageId");

          // 2) Persist atomically
          await prisma.$transaction(async (tx) => {
            const conversation = await tx.conversation.upsert({
              where: { tenantId_threadKey: { tenantId: job.tenantId, threadKey: plusToken } },
              create: {
                tenantId: job.tenantId,
                threadKey: plusToken,
                subject: renderedSubject,
                participants: [job.template.from, toEmail],
                firstMessageAt: new Date(),
                lastMessageAt: new Date(),
              },
              update: {
                // preserve original subject if already set
                ...( (await tx.conversation.findUnique({
                      where: { tenantId_threadKey: { tenantId: job.tenantId, threadKey: plusToken } },
                      select: { subject: true },
                    }))?.subject
                    ? {}
                    : { subject: renderedSubject }
                ),
                participants: {
                  set: Array.from(
                    new Set([
                      job.template.from,
                      toEmail,
                      ...(
                        (await tx.conversation.findUnique({
                          where: { tenantId_threadKey: { tenantId: job.tenantId, threadKey: plusToken } },
                          select: { participants: true },
                        }))?.participants || []
                      ),
                    ])
                  ),
                },
                lastMessageAt: new Date(),
              },
              select: { id: true },
            });

            await tx.emailMessage.create({
              data: {
                tenantId: job.tenantId,
                conversationId: conversation.id,
                direction: "OUTBOUND",
                provider: "AWS_SES",
                providerMessageId,
                subject: renderedSubject,
                from: [job.template.from],
                to: [toEmail],
                html: renderedHtml,
                headers: { "Reply-To": replyToAddress },
                verdicts: {},
                plusToken,
                sentAt: new Date(),
                campaignId: job.campaignId || null,
                leadId: lead.id,
                lastDeliveryStatus: "SENT",
              },
            });

            await tx.bulkEmailJobLead.update({
              where: { id: jobLead.id },
              data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
            });
          });

        } catch (sendError) {
          console.error(`Send error for ${toEmail}`, sendError);
          const updated = await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { attempts: { increment: 1 } },
            select: { attempts: true },
          });
          const shouldRetry = updated.attempts < MAX_ATTEMPTS;
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: shouldRetry ? "QUEUED" : "FAILED" },
          });
        }
      }

      // 3) Advance window + job status
      const remainingQueued = await prisma.bulkEmailJobLead.count({
        where: { jobId: job.id, status: "QUEUED" },
      });

      const processedCount = job.total - remainingQueued; // counts SENT+FAILED as progress; adjust if you prefer SENT only
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: {
          progress: processedCount,
          status: remainingQueued ? "QUEUED" : "COMPLETED",
          nextProcessTime: remainingQueued ? new Date(now.getTime() + WINDOW_MS) : null,
          completedAt: remainingQueued ? null : new Date(),
        },
      });

      if (job.campaignId) {
        await prisma.emailCampaign.update({
          where: { id: job.campaignId },
          data: { status: remainingQueued ? "ACTIVE" : "COMPLETED" },
        });
      }
    } catch (jobError) {
      console.error("Error while processing job window", { jobId: job.id, jobError });
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", nextProcessTime: new Date(now.getTime() + WINDOW_MS) },
      });
    }
  }
}


// export async function processNextBatch() {
//   console.log("Starting next batch window");
//   const now = new Date();

//   // 1) Find all due jobs (queued or already processing) and include template
//   const dueJobs = await prisma.bulkEmailJob.findMany({
//     where: {
//       status: { in: ["QUEUED", "PROCESSING"] },
//       nextProcessTime: { lte: now },
//     },
//     include: { template: true },
//   });

//   console.log(dueJobs);

//   for (const job of dueJobs) {
//     try {
//       // 2) Mark job PROCESSING for this window
//       await prisma.bulkEmailJob.update({
//         where: { id: job.id },
//         data: { status: "PROCESSING", lastProcessedAt: now },
//       });

//       console.log("Processing job", job);

//       // 3) Compute batch size for this minute window
//       const perWindow = Math.max(1, Math.ceil(job.rateLimit / WINDOWS_PER_HOUR));

//       // 4) Pull next leads for this job
//       const jobLeads = await prisma.bulkEmailJobLead.findMany({
//         where: { jobId: job.id, status: "QUEUED" },
//         include: { lead: true },
//         take: perWindow,
//       });

//       // 5) Send to each lead (sequentially to respect simple pacing)
//       for (const jobLead of jobLeads) {
//         const lead = jobLead.lead;

//         // Build mustache variables (extend as you like)
//         const templateVars = {
//           contactName: lead.contactName ?? "",
//           companyName: lead.companyName ?? "",
//           email: (lead.contactEmail ?? [])[0] ?? "",
//           ...lead,
//         };

//         const renderedSubject = mustache.render(job.template.subject, templateVars);
//         const renderedHtml = mustache.render(job.template.body, templateVars);
//         const toEmail = templateVars.email;

//         if (!toEmail) {
//           console.error("Lead has no primary email; marking FAILED", { leadId: lead.id });
//           await prisma.bulkEmailJobLead.update({
//             where: { id: jobLead.id },
//             data: { status: "FAILED", attempts: { increment: 1 } },
//           });
//           continue;
//         }

//         // Generate a thread token for reply+token@inbound
//         const plusToken = crypto.randomUUID();

//         // Resolve verified inbound subdomain for this tenant
//         const inboundSubdomain = await prisma.domainIdentity.findFirst({
//           where: {
//             tenantId: job.tenantId,
//             domainName: { startsWith: "inbound." },
//             verificationStatus: "Success",
//           },
//           select: { domainName: true },
//         });

//         if (!inboundSubdomain) {
//           console.error("No verified inbound subdomain for tenant; marking FAILED", {
//             tenantId: job.tenantId,
//           });
//           await prisma.bulkEmailJobLead.update({
//             where: { id: jobLead.id },
//             data: { status: "FAILED", attempts: { increment: 1 } },
//           });
//           continue;
//         }

//         const replyToAddress = `reply+${plusToken}@${inboundSubdomain.domainName}`;

//         try {
//           // 5.1 Send email with SES first (obtain provider MessageId)
//           const sendResponse = await sendEmail({
//             fromEmail: job.template.from,
//             toEmail,
//             subject: renderedSubject,
//             htmlBody: renderedHtml,
//             configurationSetName: process.env.SES_CONFIGURATION_SET,
//             replyToAddresses: [replyToAddress],
//             messageTags: [
//               { Name: "tenantId", Value: job.tenantId },
//               { Name: "jobId", Value: job.id },
//               { Name: "campaignId", Value: job.campaignId || "" },
//               { Name: "leadId", Value: lead.id },
//               { Name: "threadKey", Value: plusToken },
//             ],
//           });

//           const providerMessageId = sendResponse?.MessageId;
//           if (!providerMessageId) {
//             throw new Error("SES did not return MessageId");
//           }

//           // 5.2 Persist Conversation + OUTBOUND EmailMessage + mark lead SENT atomically
//           await prisma.$transaction(async (tx) => {
//             // upsert conversation by (tenantId, threadKey=plusToken)
//             const conversation = await tx.conversation.upsert({
//               where: {
//                 tenantId_threadKey: {
//                   tenantId: job.tenantId,
//                   threadKey: plusToken,
//                 },
//               },
//               create: {
//                 tenantId: job.tenantId,
//                 threadKey: plusToken,
//                 subject: renderedSubject,
//                 participants: [job.template.from, toEmail],
//               },
//               update: {
//                 subject: { set: renderedSubject },
//                 participants: {
//                   set: Array.from(
//                     new Set([
//                       job.template.from,
//                       toEmail,
//                       ...(
//                         (await tx.conversation.findUnique({
//                           where: {
//                             tenantId_threadKey: {
//                               tenantId: job.tenantId,
//                               threadKey: plusToken,
//                             },
//                           },
//                           select: { participants: true },
//                         }))?.participants || []
//                       ),
//                     ])
//                   ),
//                 },
//                 lastMessageAt: new Date(),
//               },
//             });

//             // create OUTBOUND email message with providerMessageId (required by schema)
//             await tx.emailMessage.create({
//               data: {
//                 tenantId: job.tenantId,
//                 conversationId: conversation.id,
//                 direction: "OUTBOUND",
//                 provider: "AWS_SES",
//                 providerMessageId,
//                 subject: renderedSubject,
//                 from: [job.template.from],
//                 to: [toEmail],
//                 html: renderedHtml,
//                 headers: { "Reply-To": replyToAddress },
//                 verdicts: {},
//                 plusToken,
//                 sentAt: new Date(),
//                 campaignId: job.campaignId || null,
//                 leadId: lead.id,
//               },
//             });

//             // mark this jobLead as SENT
//             await tx.bulkEmailJobLead.update({
//               where: { id: jobLead.id },
//               data: {
//                 status: "SENT",
//                 sentAt: new Date(),
//                 attempts: { increment: 1 },
//               },
//             });
//           });
//         } catch (sendError) {
//           console.error(`Send error for ${toEmail}`, sendError);

//           // Backoff / retry bookkeeping (no EmailMessage row without providerMessageId)
//           const updated = await prisma.bulkEmailJobLead.update({
//             where: { id: jobLead.id },
//             data: { attempts: { increment: 1 } },
//             select: { attempts: true },
//           });

//           const shouldRetry = updated.attempts < MAX_ATTEMPTS;

//           await prisma.bulkEmailJobLead.update({
//             where: { id: jobLead.id },
//             data: { status: shouldRetry ? "QUEUED" : "FAILED" },
//           });
//         }
//       }

//       // 6) Update job schedule and progress for the next window
//       const remainingQueued = await prisma.bulkEmailJobLead.count({
//         where: { jobId: job.id, status: "QUEUED" },
//       });

//       const processedCount = job.total - remainingQueued;

//       await prisma.bulkEmailJob.update({
//         where: { id: job.id },
//         data: {
//           progress: processedCount,
//           status: remainingQueued ? "QUEUED" : "COMPLETED",
//           nextProcessTime: remainingQueued
//             ? new Date(now.getTime() + WINDOW_MS)
//             : null,
//           completedAt: remainingQueued ? null : new Date(),
//         },
//       });

//       if (job.campaignId) {
//         await prisma.emailCampaign.update({
//           where: { id: job.campaignId },
//           data: { status: remainingQueued ? "ACTIVE" : "COMPLETED" },
//         });
//       }
//     } catch (jobError) {
//       console.error("Error while processing job window", { jobId: job.id, jobError });
//       // If something big failed, try to push job to next window to avoid tight loops
//       await prisma.bulkEmailJob.update({
//         where: { id: job.id },
//         data: {
//           status: "QUEUED",
//           nextProcessTime: new Date(now.getTime() + WINDOW_MS),
//         },
//       });
//     }
//   }
// }