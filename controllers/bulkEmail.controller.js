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
const WINDOW_MS = Math.floor(3600000 / WINDOWS_PER_HOUR);

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
 * Worker loop: run every minute (or per your scheduler). It:
 * - Picks jobs whose nextProcessTime ≤ now and status in [QUEUED, PROCESSING]
 * - Sends up to `perWindow` leads this tick
 * - Supports:
 *    (A) TEMPLATE mode (job.template present)
 *    (B) DRAFT mode (no template) -> sends EmailMessage drafts from Python service
 */
export async function processNextBatch() {
  const now = new Date();
  console.log(`[bulk] tick @ ${now.toISOString()}`);

  // Make rate split robust: if WINDOW_MS is set, derive windows/hour from it; else fall back.
  const effectiveWindowMs =
    typeof WINDOW_MS === "number" && WINDOW_MS > 0
      ? WINDOW_MS
      : Math.floor(3600000 / (WINDOWS_PER_HOUR || 6));
  const windowsPerHour = Math.max(1, Math.floor(3600000 / effectiveWindowMs));

  const dueJobs = await prisma.bulkEmailJob.findMany({
    where: {
      status: { in: ["QUEUED", "PROCESSING"] },
      nextProcessTime: { lte: now },
    },
    include: { template: true },
  });

  if (!dueJobs.length) {
    console.log("[bulk] no due jobs");
    return;
  }

  console.log(`[bulk] due jobs: ${dueJobs.length}`);

  for (const job of dueJobs) {
    const jobCtx = { jobId: job.id, tenantId: job.tenantId };
    console.log("[bulk] start job window", {
      ...jobCtx,
      rateLimit: job.rateLimit,
      total: job.total,
      progress: job.progress,
      nextProcessTime: job.nextProcessTime?.toISOString?.(),
      hasTemplate: !!job.template,
      windowsPerHour,
      effectiveWindowMs,
    });

    try {
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING", lastProcessedAt: now },
      });

      // how many we can send this window
      // If rateLimit = emails/hour, perWindow = ceil(rateLimit * (windowMs/3600000))
      const perWindow = Math.max(
        1,
        Math.ceil(job.rateLimit * (effectiveWindowMs / 3600000))
      );
      console.log("[bulk] computed perWindow", { ...jobCtx, perWindow });

      const jobLeads = await prisma.bulkEmailJobLead.findMany({
        where: { jobId: job.id, status: "QUEUED" },
        include: { lead: true },
        take: perWindow,
      });

      if (!jobLeads.length) {
        console.log("[bulk] no queued leads for this job", jobCtx);
      }

      for (const jobLead of jobLeads) {
        const lead = jobLead.lead;
        const leadCtx = { ...jobCtx, jobLeadId: jobLead.id, leadId: lead?.id };
        try {
          // Prefer a clean primary email
          const toEmail = (lead?.contactEmail || []).find((e) => e && e.trim());
          if (!toEmail) {
            console.error("[bulk] lead missing email; marking FAILED", leadCtx);
            await prisma.bulkEmailJobLead.update({
              where: { id: jobLead.id },
              data: { status: "FAILED", attempts: { increment: 1 } },
            });
            continue;
          }

          // Verify inbound subdomain (for Reply-To). Accept "Success" or "Verified".
          const inboundSubdomain = await prisma.domainIdentity.findFirst({
            where: {
              tenantId: job.tenantId,
              domainName: { startsWith: "inbound." },
              verificationStatus: { in: ["Success", "Verified"] },
            },
            select: { domainName: true },
          });
          if (!inboundSubdomain) {
            console.error(
              "[bulk] no verified inbound subdomain; marking FAILED",
              leadCtx
            );
            await prisma.bulkEmailJobLead.update({
              where: { id: jobLead.id },
              data: { status: "FAILED", attempts: { increment: 1 } },
            });
            continue;
          }

          // ============== MODE B: DRAFT (AI-generated) ==================
          if (!job.template) {
            console.log("[bulk] DRAFT mode for lead", leadCtx);

            // Find Python-created draft (providerMessageId startsWith "generated-")
            const draft = await prisma.emailMessage.findFirst({
              where: {
                tenantId: job.tenantId,
                campaignId: job.campaignId ?? null,
                leadId: lead.id,
                direction: "OUTBOUND",
                providerMessageId: { startsWith: "generated-" },
              },
              orderBy: { createdAt: "desc" },
            });

            if (!draft) {
              console.error("[bulk] draft not found; marking FAILED", leadCtx);
              await prisma.bulkEmailJobLead.update({
                where: { id: jobLead.id },
                data: { status: "FAILED", attempts: { increment: 1 } },
              });
              continue;
            }

            // plusToken for Reply-To
            let plusToken = draft.plusToken;
            if (!plusToken) {
              const conv = await prisma.conversation.findUnique({
                where: { id: draft.conversationId },
                select: { threadKey: true },
              });
              plusToken = conv?.threadKey || crypto.randomUUID();
              if (!draft.plusToken) {
                await prisma.emailMessage.update({
                  where: { id: draft.id },
                  data: { plusToken },
                });
              }
            }
            const replyToAddress = `reply+${plusToken}@${inboundSubdomain.domainName}`;

            const fromEmail = (draft.from || [])[0];
            if (!fromEmail) {
              console.error("[bulk] draft missing from; marking FAILED", {
                ...leadCtx,
                draftId: draft.id,
              });
              await prisma.bulkEmailJobLead.update({
                where: { id: jobLead.id },
                data: { status: "FAILED", attempts: { increment: 1 } },
              });
              continue;
            }
            const htmlBody = draft.html || draft.text || "";

            console.log("[bulk] sending DRAFT", {
              ...leadCtx,
              draftId: draft.id,
            });
            try {
              const sendResponse = await sendEmail({
                fromEmail,
                toEmail,
                subject: draft.subject || "",
                htmlBody,
                configurationSetName: process.env.SES_CONFIGURATION_SET,
                replyToAddresses: [replyToAddress],
                messageTags: [
                  { Name: "tenantId", Value: job.tenantId },
                  ...(job.campaignId
                    ? [{ Name: "campaignId", Value: job.campaignId }]
                    : []),
                  { Name: "leadId", Value: lead.id },
                ],
              });

              const providerMessageId = sendResponse?.MessageId;
              if (!providerMessageId)
                throw new Error("SES did not return MessageId");

              await prisma.$transaction(async (tx) => {
                await tx.emailMessage.update({
                  where: { id: draft.id },
                  data: {
                    providerMessageId, // overwrite generated-*
                    sentAt: draft.sentAt ?? new Date(),
                    lastDeliveryStatus: "SENT",
                    lastEventAt: new Date(),
                    headers: {
                      ...(draft.headers || {}),
                      "Reply-To": replyToAddress,
                    },
                  },
                });

                await tx.bulkEmailJobLead.update({
                  where: { id: jobLead.id },
                  data: {
                    status: "SENT",
                    sentAt: new Date(),
                    attempts: { increment: 1 },
                  },
                });

                await tx.conversation.update({
                  where: { id: draft.conversationId },
                  data: { lastMessageAt: new Date() },
                });

                await tx.emailEvent.create({
                  data: {
                    tenantId: job.tenantId,
                    emailMessageId: draft.id,
                    providerMessageId,
                    eventType: "Send",
                    occurredAt: new Date(),
                    payload: {},
                    snsMessageId: `local-send-${draft.id}-${Date.now()}`, // unique local id
                  },
                });
              });

              console.log("[bulk] DRAFT sent", {
                ...leadCtx,
                providerMessageId,
              });
            } catch (sendErr) {
              console.error("[bulk] send error (DRAFT)", {
                ...leadCtx,
                error: String(sendErr?.message || sendErr),
              });
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

            // Done with this lead
            continue;
          }

          // ============== MODE A: TEMPLATE (existing) ==================
          if (!job.template || !job.template.from) {
            console.error(
              "[bulk] template missing or no from; marking FAILED",
              leadCtx
            );
            await prisma.bulkEmailJobLead.update({
              where: { id: jobLead.id },
              data: { status: "FAILED", attempts: { increment: 1 } },
            });
            continue;
          }

          // Render subject/body with mustache
          const templateVars = {
            contactName: lead.contactName ?? "",
            companyName: lead.companyName ?? "",
            email: toEmail,
            ...lead,
          };

          let renderedSubject, renderedHtml;
          try {
            renderedSubject = mustache.render(
              job.template.subject,
              templateVars
            );
            renderedHtml = mustache.render(job.template.body, templateVars);
          } catch (e) {
            console.error("[bulk] template render failed; marking FAILED", {
              ...leadCtx,
              error: String(e?.message || e),
            });
            await prisma.bulkEmailJobLead.update({
              where: { id: jobLead.id },
              data: { status: "FAILED", attempts: { increment: 1 } },
            });
            continue;
          }

          const plusToken = crypto.randomUUID();
          const replyToAddress = `reply+${plusToken}@${inboundSubdomain.domainName}`;

          console.log("[bulk] sending TEMPLATE", leadCtx);
          try {
            const sendResponse = await sendEmail({
              fromEmail: job.template.from,
              toEmail,
              subject: renderedSubject,
              htmlBody: renderedHtml,
              configurationSetName: process.env.SES_CONFIGURATION_SET,
              replyToAddresses: [replyToAddress],
              messageTags: [
                { Name: "tenantId", Value: job.tenantId },
                { Name: "replyToToken", Value: plusToken },
                ...(job.campaignId
                  ? [{ Name: "campaignId", Value: job.campaignId }]
                  : []),
                { Name: "leadId", Value: lead.id },
              ],
            });

            const providerMessageId = sendResponse?.MessageId;
            if (!providerMessageId)
              throw new Error("SES did not return MessageId");

            await prisma.$transaction(async (tx) => {
              // Upsert conversation by threadKey=plusToken
              let conv = await tx.conversation.findUnique({
                where: {
                  tenantId_threadKey: {
                    tenantId: job.tenantId,
                    threadKey: plusToken,
                  },
                },
              });
              if (!conv) {
                conv = await tx.conversation.create({
                  data: {
                    tenantId: job.tenantId,
                    threadKey: plusToken,
                    subject: renderedSubject,
                    participants: [job.template.from, toEmail],
                    firstMessageAt: new Date(),
                    lastMessageAt: new Date(),
                  },
                });
              } else {
                const existing = await tx.conversation.findUnique({
                  where: {
                    tenantId_threadKey: {
                      tenantId: job.tenantId,
                      threadKey: plusToken,
                    },
                  },
                  select: { participants: true, subject: true },
                });
                const mergedParticipants = Array.from(
                  new Set([
                    ...(existing?.participants || []),
                    job.template.from,
                    toEmail,
                  ])
                );
                await tx.conversation.update({
                  where: { id: conv.id },
                  data: {
                    participants: { set: mergedParticipants },
                    // keep original subject if set
                    ...(existing?.subject ? {} : { subject: renderedSubject }),
                    lastMessageAt: new Date(),
                  },
                });
              }

              const emailMessageCreated = await tx.emailMessage.create({
                data: {
                  tenantId: job.tenantId,
                  conversationId: conv.id,
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
                  lastEventAt: new Date(),
                },
              });

              await tx.bulkEmailJobLead.update({
                where: { id: jobLead.id },
                data: {
                  status: "SENT",
                  sentAt: new Date(),
                  attempts: { increment: 1 },
                },
              });

              await tx.emailEvent.create({
                data: {
                  tenantId: job.tenantId,
                  emailMessageId: emailMessageCreated.id, // NOTE: changed from conv.id to emailMessageCreated.id
                  providerMessageId,
                  eventType: "Send",
                  occurredAt: new Date(),
                  payload: {},
                  snsMessageId: `local-send-template-${conv.id}-${Date.now()}`, // NOTE: unsure what to use here among conv.id and emailMessageCreated.id
                },
              });
            });

            console.log("[bulk] TEMPLATE sent", {
              ...leadCtx,
              providerMessageId,
            });
          } catch (sendErr) {
            console.error("[bulk] send error (TEMPLATE)", {
              ...leadCtx,
              error: String(sendErr?.message || sendErr),
            });
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
        } catch (leadErr) {
          console.error("[bulk] unexpected error per lead", {
            ...leadCtx,
            error: String(leadErr?.message || leadErr),
          });
          await prisma.bulkEmailJobLead.update({
            where: { id: jobLead.id },
            data: { status: "FAILED", attempts: { increment: 1 } },
          });
        }
      }

      // Progress + next window schedule
      const remainingQueued = await prisma.bulkEmailJobLead.count({
        where: { jobId: job.id, status: "QUEUED" },
      });
      const processedCount = job.total - remainingQueued; // SENT+FAILED considered progress
      const nextTime = remainingQueued
        ? new Date(Date.now() + effectiveWindowMs)
        : null;

      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: {
          progress: processedCount,
          status: remainingQueued ? "QUEUED" : "COMPLETED",
          nextProcessTime: nextTime,
          completedAt: remainingQueued ? null : new Date(),
        },
      });

      if (job.campaignId) {
        await prisma.emailCampaign.update({
          where: { id: job.campaignId },
          data: { status: remainingQueued ? "ACTIVE" : "COMPLETED" },
        });
      }

      console.log("[bulk] job window done", {
        ...jobCtx,
        processedThisTick: jobLeads.length,
        remainingQueued,
        nextProcessTime: nextTime?.toISOString?.() || null,
      });
    } catch (jobError) {
      console.error("[bulk] job window error; rescheduling to next window", {
        ...jobCtx,
        error: String(jobError?.message || jobError),
      });
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          nextProcessTime: new Date(Date.now() + effectiveWindowMs),
        },
      });
    }
  }
}