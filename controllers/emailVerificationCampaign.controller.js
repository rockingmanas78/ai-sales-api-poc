// src/controllers/emailVerificationCampaign.controller.js
import { verifyEmailsBulk } from "../services/emailVerification.service.js";
import prisma from "../utils/prisma.client.js";

/**
 * POST /api/email-verification/campaign/:campaignId/verify-recipients
 * Body: { maxBatchSize?: number }
 *
 * Behavior:
 * - Find leads for this campaign via CampaignLead
 * - For each lead, use primary contactEmail[0]
 * - Only verify those with:
 *   - no metadata.emailVerification, OR
 *   - lastCheckedAt older than TTL (e.g., 7 days)
 * - Limit to maxBatchSize (default 50) per call
 * - Persist results on Lead.metadata.emailVerification
 */
export async function verifyCampaignRecipientsController(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { campaignId } = req.params;
    const { maxBatchSize } = req.body || {};

    if (!tenantId) {
      return res.status(401).json({ error: "Tenant context required" });
    }
    if (!campaignId) {
      return res.status(400).json({ error: "campaignId required" });
    }

    const TTL_DAYS = 7;
    const now = new Date();
    const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;

    const campaignLeads = await prisma.campaignLead.findMany({
      where: { campaignId },
      include: {
        lead: {
          select: {
            id: true,
            tenantId: true,
            contactEmail: true,
            metadata: true,
          },
        },
      },
    });

    const candidates = [];
    let remainingUnverified = 0;

    for (const cl of campaignLeads) {
      const lead = cl.lead;
      if (!lead || lead.tenantId !== tenantId) continue;

      const primaryEmail = (lead.contactEmail || []).find(
        (e) => e && e.trim()
      );
      if (!primaryEmail) {
        remainingUnverified++;
        continue;
      }

      const meta = lead.metadata || {};
      const ev = meta.emailVerification || null;
      let needsVerification = false;

      if (!ev || !ev.status || !ev.lastCheckedAt) {
        needsVerification = true;
      } else {
        const last = new Date(ev.lastCheckedAt);
        if (Number.isFinite(last.getTime())) {
          const age = now.getTime() - last.getTime();
          if (age > ttlMs) {
            needsVerification = true;
          }
        } else {
          needsVerification = true;
        }
      }

      if (needsVerification) {
        remainingUnverified++;
        candidates.push({
          leadId: lead.id,
          email: primaryEmail,
          existing: ev,
        });
      }
    }

    const MAX_PER_BATCH = 50;
    const batch = candidates.slice(0, maxBatchSize || MAX_PER_BATCH);

    if (batch.length === 0) {
      return res.json({
        message: "No recipients need re-verification",
        processedCount: 0,
        remainingUnverified,
        results: [],
        summary: { total: 0, byStatus: {} },
      });
    }

    const emails = batch.map((b) => b.email);
    const verificationResults = await verifyEmailsBulk(emails, {
      concurrency: 5,
    });

    const resultByEmail = new Map();
    for (const vr of verificationResults) resultByEmail.set(vr.email, vr);

    const finalResults = [];

    for (const entry of batch) {
      const vr = resultByEmail.get(entry.email);
      if (!vr) {
        finalResults.push({
          leadId: entry.leadId,
          email: entry.email,
          status: "UNKNOWN",
          reason: "No verification result",
          checkedAt: new Date().toISOString(),
          subStatus: "UNKNOWN",
          riskLevel: "MEDIUM",
        });
        continue;
      }

      const lead = await prisma.lead.findUnique({
        where: { id: entry.leadId },
        select: { metadata: true },
      });
      const existingMetadata = lead?.metadata || {};
      const newMetadata = {
        ...existingMetadata,
        emailVerification: {
          status: vr.status,
          reason: vr.reason,
          lastCheckedAt: vr.checkedAt,
          subStatus: vr.subStatus,
          riskLevel: vr.riskLevel,
          mxDomain: vr.mxDomain,
        },
      };
      await prisma.lead.update({
        where: { id: entry.leadId },
        data: { metadata: newMetadata },
      });

      finalResults.push({
        leadId: entry.leadId,
        email: entry.email,
        ...vr,
      });
    }

    const summary = finalResults.reduce(
      (acc, r) => {
        acc.total++;
        acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} }
    );

    const remainingAfterBatch = Math.max(0, remainingUnverified - batch.length);

    return res.json({
      message: "Campaign recipients verification batch processed",
      processedCount: finalResults.length,
      remainingUnverified: remainingAfterBatch,
      results: finalResults,
      summary,
    });
  } catch (err) {
    next(err);
  }
}



// // src/controllers/emailVerificationCampaign.controller.js
// import { verifyEmailsBulk } from "../services/emailVerification.service.js";
// import prisma from "../utils/prisma.client.js";

// /**
//  * POST /api/email-verification/campaign/:campaignId/verify-recipients
//  * Body: { maxBatchSize?: number }
//  *
//  * Behavior:
//  * - Find leads for this campaign via CampaignLead
//  * - For each lead, use primary contactEmail[0]
//  * - Only verify those with:
//  *   - no metadata.emailVerification, OR
//  *   - lastCheckedAt older than TTL (e.g., 7 days)
//  * - Limit to maxBatchSize (default 50) per call
//  * - Persist results on Lead.metadata.emailVerification
//  */
// export async function verifyCampaignRecipientsController(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const { campaignId } = req.params;
//     const { maxBatchSize } = req.body || {};

//     if (!tenantId) {
//       return res.status(401).json({ error: "Tenant context required" });
//     }
//     if (!campaignId) {
//       return res.status(400).json({ error: "campaignId required" });
//     }

//     const TTL_DAYS = 7;
//     const now = new Date();
//     const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;

//     const campaignLeads = await prisma.campaignLead.findMany({
//       where: { campaignId },
//       include: {
//         lead: {
//           select: {
//             id: true,
//             tenantId: true,
//             contactEmail: true,
//             metadata: true,
//           },
//         },
//       },
//     });

//     const candidates = [];
//     let remainingUnverified = 0;

//     for (const cl of campaignLeads) {
//       const lead = cl.lead;
//       if (!lead || lead.tenantId !== tenantId) continue;

//       const primaryEmail = (lead.contactEmail || []).find(
//         (e) => e && e.trim()
//       );
//       if (!primaryEmail) {
//         remainingUnverified++;
//         continue;
//       }

//       const meta = lead.metadata || {};
//       const ev = meta.emailVerification || null;
//       let needsVerification = false;

//       if (!ev || !ev.status || !ev.lastCheckedAt) {
//         needsVerification = true;
//       } else {
//         const last = new Date(ev.lastCheckedAt);
//         if (Number.isFinite(last.getTime())) {
//           const age = now.getTime() - last.getTime();
//           if (age > ttlMs) {
//             needsVerification = true;
//           }
//         } else {
//           needsVerification = true;
//         }
//       }

//       if (needsVerification) {
//         remainingUnverified++;
//         candidates.push({
//           leadId: lead.id,
//           email: primaryEmail,
//           existing: ev,
//         });
//       }
//     }

//     const MAX_PER_BATCH = 50;
//     const batch = candidates.slice(0, maxBatchSize || MAX_PER_BATCH);

//     if (batch.length === 0) {
//       return res.json({
//         message: "No recipients need re-verification",
//         processedCount: 0,
//         remainingUnverified,
//         results: [],
//         summary: { total: 0, byStatus: {} },
//       });
//     }

//     const emails = batch.map((b) => b.email);
//     const verificationResults = await verifyEmailsBulk(emails, {
//       concurrency: 5,
//     });

//     const resultByEmail = new Map();
//     for (const vr of verificationResults) resultByEmail.set(vr.email, vr);

//     const finalResults = [];

//     for (const entry of batch) {
//       const vr = resultByEmail.get(entry.email);
//       if (!vr) {
//         finalResults.push({
//           leadId: entry.leadId,
//           email: entry.email,
//           status: "UNKNOWN",
//           reason: "No verification result",
//           checkedAt: new Date().toISOString(),
//         });
//         continue;
//       }

//       const lead = await prisma.lead.findUnique({
//         where: { id: entry.leadId },
//         select: { metadata: true },
//       });
//       const existingMetadata = lead?.metadata || {};
//       const newMetadata = {
//         ...existingMetadata,
//         emailVerification: {
//           status: vr.status,
//           reason: vr.reason,
//           lastCheckedAt: vr.checkedAt,
//         },
//       };
//       await prisma.lead.update({
//         where: { id: entry.leadId },
//         data: { metadata: newMetadata },
//       });

//       finalResults.push({
//         leadId: entry.leadId,
//         email: entry.email,
//         ...vr,
//       });
//     }

//     const summary = finalResults.reduce(
//       (acc, r) => {
//         acc.total++;
//         acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
//         return acc;
//       },
//       { total: 0, byStatus: {} }
//     );

//     const remainingAfterBatch = Math.max(0, remainingUnverified - batch.length);

//     return res.json({
//       message: "Campaign recipients verification batch processed",
//       processedCount: finalResults.length,
//       remainingUnverified: remainingAfterBatch,
//       results: finalResults,
//       summary,
//     });
//   } catch (err) {
//     next(err);
//   }
// }



// // // src/controllers/emailVerificationCampaign.controller.js
// // import { PrismaClient } from "@prisma/client";
// // import { verifyEmailsBulk } from "../services/emailVerification.service.js";
// // import prisma from "../utils/prisma.client.js";


// // /**
// //  * POST /api/email-verification/campaign/:campaignId/verify-recipients
// //  * Body: { maxBatchSize?: number }
// //  *
// //  * Behavior:
// //  * - Find leads for this campaign via CampaignLead
// //  * - For each lead, read primary email + verification metadata
// //  * - Only verify those with:
// //  *   - no metadata.emailVerification, OR
// //  *   - lastCheckedAt older than some TTL (e.g., 7 days)
// //  * - Limit to maxBatchSize (default 50) per call
// //  * - Persist results on Lead.metadata
// //  * - Return:
// //  *   - processed count
// //  *   - remainingUnverified count
// //  *   - result breakdown
// //  */
// // export async function verifyCampaignRecipientsController(req, res, next) {
// //   try {
// //     const tenantId = req.user?.tenantId;
// //     const { campaignId } = req.params;
// //     const { maxBatchSize } = req.body || {};

// //     if (!tenantId) {
// //       return res.status(401).json({ error: "Tenant context required" });
// //     }
// //     if (!campaignId) {
// //       return res.status(400).json({ error: "campaignId required" });
// //     }

// //     // TTL for "fresh enough" verification (e.g. 7 days)
// //     const TTL_DAYS = 7;
// //     const now = new Date();
// //     const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;

// //     // Load campaign leads + their lead + metadata
// //     const campaignLeads = await prisma.campaignLead.findMany({
// //       where: { campaignId },
// //       include: {
// //         lead: {
// //           select: { id: true, tenantId: true, contactEmail: true, metadata: true },
// //         },
// //       },
// //     });

// //     const candidates = [];
// //     let remainingUnverified = 0;

// //     for (const cl of campaignLeads) {
// //       const lead = cl.lead;
// //       if (!lead || lead.tenantId !== tenantId) continue;

// //       const primaryEmail = (lead.contactEmail || []).find((e) => e && e.trim());
// //       if (!primaryEmail) {
// //         remainingUnverified++;
// //         continue;
// //       }

// //       const meta = lead.metadata || {};
// //       const ev = meta.emailVerification || null;
// //       let needsVerification = false;

// //       if (!ev || !ev.status || !ev.lastCheckedAt) {
// //         needsVerification = true;
// //       } else {
// //         const last = new Date(ev.lastCheckedAt);
// //         if (Number.isFinite(last.getTime())) {
// //           const age = now.getTime() - last.getTime();
// //           if (age > ttlMs) {
// //             needsVerification = true;
// //           }
// //         } else {
// //           needsVerification = true;
// //         }
// //       }

// //       if (needsVerification) {
// //         remainingUnverified++;
// //         candidates.push({
// //           leadId: lead.id,
// //           email: primaryEmail,
// //           existing: ev,
// //         });
// //       }
// //     }

// //     const MAX_PER_BATCH = 50;
// //     const batch = candidates.slice(0, maxBatchSize || MAX_PER_BATCH);

// //     if (batch.length === 0) {
// //       return res.json({
// //         message: "No recipients need re-verification",
// //         processedCount: 0,
// //         remainingUnverified,
// //         results: [],
// //         summary: { total: 0, byStatus: {} },
// //       });
// //     }

// //     const emails = batch.map((b) => b.email);
// //     const verificationResults = await verifyEmailsBulk(emails, { concurrency: 5 });

// //     const resultByEmail = new Map();
// //     for (const vr of verificationResults) resultByEmail.set(vr.email, vr);

// //     const finalResults = [];

// //     for (const entry of batch) {
// //       const vr = resultByEmail.get(entry.email);
// //       if (!vr) {
// //         finalResults.push({
// //           leadId: entry.leadId,
// //           email: entry.email,
// //           status: "UNKNOWN",
// //           reason: "No verification result",
// //           checkedAt: new Date().toISOString(),
// //         });
// //         continue;
// //       }

// //       // Persist on lead.metadata
// //       const lead = await prisma.lead.findUnique({
// //         where: { id: entry.leadId },
// //         select: { metadata: true },
// //       });
// //       const existingMetadata = lead?.metadata || {};
// //       const newMetadata = {
// //         ...existingMetadata,
// //         emailVerification: {
// //           status: vr.status,
// //           reason: vr.reason,
// //           lastCheckedAt: vr.checkedAt,
// //         },
// //       };
// //       await prisma.lead.update({
// //         where: { id: entry.leadId },
// //         data: { metadata: newMetadata },
// //       });

// //       finalResults.push({
// //         leadId: entry.leadId,
// //         email: entry.email,
// //         ...vr,
// //       });
// //     }

// //     const summary = finalResults.reduce(
// //       (acc, r) => {
// //         acc.total++;
// //         acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
// //         return acc;
// //       },
// //       { total: 0, byStatus: {} }
// //     );

// //     // remainingUnverified was computed across all campaign leads; subtract processed ones
// //     const remainingAfterBatch = Math.max(0, remainingUnverified - batch.length);

// //     return res.json({
// //       message: "Campaign recipients verification batch processed",
// //       processedCount: finalResults.length,
// //       remainingUnverified: remainingAfterBatch,
// //       results: finalResults,
// //       summary,
// //     });
// //   } catch (err) {
// //     next(err);
// //   }
// // }
