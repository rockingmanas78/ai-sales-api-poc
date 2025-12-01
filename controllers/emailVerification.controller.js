// src/controllers/emailVerification.controller.js
import { verifySingleEmail, verifyEmailsBulk } from "../services/emailVerification.service.js";
import prisma from "../utils/prisma.client.js";

/**
 * Utility: persist verification result on Lead.metadata.emailVerification
 *
 * We *extend* the stored data with subStatus, riskLevel, mxDomain
 * without breaking existing consumers that only read `status`.
 */
async function persistVerificationOnLead(leadId, tenantId, verificationResult) {
  const { status, reason, checkedAt, subStatus, riskLevel, mxDomain } =
    verificationResult;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { metadata: true },
  });
  if (!lead) return;

  const existingMetadata = lead.metadata || {};
  const newMetadata = {
    ...existingMetadata,
    emailVerification: {
      status,
      reason,
      lastCheckedAt: checkedAt,
      subStatus,
      riskLevel,
      mxDomain,
    },
  };

  await prisma.lead.update({
    where: { id: leadId },
    data: { metadata: newMetadata },
  });
}

/**
 * POST /api/email-verification/check
 * Body: { email: string, leadId?: string }
 */
export async function verifySingleEmailController(req, res, next) {
  try {
    const { email, leadId } = req.body;
    const tenantId = req.user?.tenantId;

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const result = await verifySingleEmail(email);

    if (leadId && tenantId) {
      await persistVerificationOnLead(leadId, tenantId, result);
    }

    return res.json({ result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/email-verification/bulk
 * Body: { emails: string[], maxBatchSize?: number }
 */
export async function verifyEmailsBulkController(req, res, next) {
  try {
    const { emails, maxBatchSize } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "emails[] is required" });
    }

    const MAX_PER_BATCH = 50;
    const trimmed = emails.slice(0, maxBatchSize || MAX_PER_BATCH);

    const results = await verifyEmailsBulk(trimmed, { concurrency: 5 });

    const summary = results.reduce(
      (acc, r) => {
        acc.total++;
        acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} }
    );

    return res.json({ results, summary, batchSize: trimmed.length });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/email-verification/leads
 * Body: { leadIds: string[], maxBatchSize?: number }
 * Reads primary contactEmail[0] for each lead, verifies, and persists on metadata.
 */
export async function verifyLeadsBulkController(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { leadIds, maxBatchSize } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: "Tenant context required" });
    }
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: "leadIds[] is required" });
    }

    const MAX_PER_BATCH = 50;
    const limitedLeadIds = leadIds.slice(0, maxBatchSize || MAX_PER_BATCH);

    const leads = await prisma.lead.findMany({
      where: {
        id: { in: limitedLeadIds },
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        contactEmail: true,
      },
    });

    const emailMap = [];
    for (const lead of leads) {
      const primaryEmail = (lead.contactEmail || []).find(
        (e) => e && e.trim()
      );
      if (!primaryEmail) {
        emailMap.push({
          leadId: lead.id,
          email: null,
          error: "No contactEmail on lead",
        });
      } else {
        emailMap.push({ leadId: lead.id, email: primaryEmail });
      }
    }

    const emailsToVerify = emailMap.filter((e) => e.email).map((e) => e.email);
    const verificationResults = await verifyEmailsBulk(emailsToVerify, {
      concurrency: 5,
    });

    const resultByEmail = new Map();
    for (const r of verificationResults) {
      resultByEmail.set(r.email, r);
    }

    const finalResults = [];

    for (const entry of emailMap) {
      if (!entry.email) {
        finalResults.push({
          leadId: entry.leadId,
          email: null,
          status: "UNDELIVERABLE",
          reason: entry.error,
          checkedAt: new Date().toISOString(),
          subStatus: "NORMAL",
          riskLevel: "HIGH",
        });
        continue;
      }

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

      await persistVerificationOnLead(entry.leadId, tenantId, vr);

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

    return res.json({
      results: finalResults,
      summary,
      processedLeadCount: finalResults.length,
    });
  } catch (err) {
    next(err);
  }
}



// // src/controllers/emailVerification.controller.js
// import { verifySingleEmail, verifyEmailsBulk } from "../services/emailVerification.service.js";
// import prisma from "../utils/prisma.client.js";

// /**
//  * Utility: persist verification result on Lead.metadata.emailVerification
//  */
// async function persistVerificationOnLead(leadId, tenantId, verificationResult) {
//   const { status, reason, checkedAt } = verificationResult;

//   const lead = await prisma.lead.findFirst({
//     where: { id: leadId, tenantId },
//     select: { metadata: true },
//   });
//   if (!lead) return;

//   const existingMetadata = lead.metadata || {};
//   const newMetadata = {
//     ...existingMetadata,
//     emailVerification: {
//       status,
//       reason,
//       lastCheckedAt: checkedAt,
//     },
//   };

//   await prisma.lead.update({
//     where: { id: leadId },
//     data: { metadata: newMetadata },
//   });
// }

// /**
//  * POST /api/email-verification/check
//  * Body: { email: string, leadId?: string }
//  */
// export async function verifySingleEmailController(req, res, next) {
//   try {
//     const { email, leadId } = req.body;
//     const tenantId = req.user?.tenantId;

//     if (!email) {
//       return res.status(400).json({ error: "email is required" });
//     }

//     const result = await verifySingleEmail(email);

//     if (leadId && tenantId) {
//       await persistVerificationOnLead(leadId, tenantId, result);
//     }

//     return res.json({ result });
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * POST /api/email-verification/bulk
//  * Body: { emails: string[], maxBatchSize?: number }
//  */
// export async function verifyEmailsBulkController(req, res, next) {
//   try {
//     const { emails, maxBatchSize } = req.body;
//     if (!Array.isArray(emails) || emails.length === 0) {
//       return res.status(400).json({ error: "emails[] is required" });
//     }

//     const MAX_PER_BATCH = 50;
//     const trimmed = emails.slice(0, maxBatchSize || MAX_PER_BATCH);

//     const results = await verifyEmailsBulk(trimmed, { concurrency: 5 });

//     const summary = results.reduce(
//       (acc, r) => {
//         acc.total++;
//         acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
//         return acc;
//       },
//       { total: 0, byStatus: {} }
//     );

//     return res.json({ results, summary, batchSize: trimmed.length });
//   } catch (err) {
//     next(err);
//   }
// }

// /**
//  * POST /api/email-verification/leads
//  * Body: { leadIds: string[], maxBatchSize?: number }
//  * Reads primary contactEmail[0] for each lead, verifies, and persists on metadata.
//  */
// export async function verifyLeadsBulkController(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const { leadIds, maxBatchSize } = req.body;

//     if (!tenantId) {
//       return res.status(401).json({ error: "Tenant context required" });
//     }
//     if (!Array.isArray(leadIds) || leadIds.length === 0) {
//       return res.status(400).json({ error: "leadIds[] is required" });
//     }

//     const MAX_PER_BATCH = 50;
//     const limitedLeadIds = leadIds.slice(0, maxBatchSize || MAX_PER_BATCH);

//     const leads = await prisma.lead.findMany({
//       where: {
//         id: { in: limitedLeadIds },
//         tenantId,
//         deletedAt: null,
//       },
//       select: {
//         id: true,
//         contactEmail: true,
//       },
//     });

//     const emailMap = [];
//     for (const lead of leads) {
//       const primaryEmail = (lead.contactEmail || []).find((e) => e && e.trim());
//       if (!primaryEmail) {
//         emailMap.push({
//           leadId: lead.id,
//           email: null,
//           error: "No contactEmail on lead",
//         });
//       } else {
//         emailMap.push({ leadId: lead.id, email: primaryEmail });
//       }
//     }

//     const emailsToVerify = emailMap.filter((e) => e.email).map((e) => e.email);
//     const verificationResults = await verifyEmailsBulk(emailsToVerify, {
//       concurrency: 5,
//     });

//     const resultByEmail = new Map();
//     for (const r of verificationResults) {
//       resultByEmail.set(r.email, r);
//     }

//     const finalResults = [];

//     for (const entry of emailMap) {
//       if (!entry.email) {
//         finalResults.push({
//           leadId: entry.leadId,
//           email: null,
//           status: "UNDELIVERABLE",
//           reason: entry.error,
//           checkedAt: new Date().toISOString(),
//         });
//         continue;
//       }

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

//       await persistVerificationOnLead(entry.leadId, tenantId, vr);

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

//     return res.json({
//       results: finalResults,
//       summary,
//       processedLeadCount: finalResults.length,
//     });
//   } catch (err) {
//     next(err);
//   }
// }



// // // src/controllers/emailVerification.controller.js
// // import { PrismaClient } from "@prisma/client";
// // import { verifySingleEmail, verifyEmailsBulk } from "../services/emailVerification.service.js";

// // import prisma from '../utils/prisma.client.js';

// // /**
// //  * Utility: persist verification result on Lead.metadata.emailVerification
// //  */
// // async function persistVerificationOnLead(leadId, tenantId, verificationResult) {
// //   const { status, reason, checkedAt } = verificationResult;

// //   // Fetch existing metadata
// //   const lead = await prisma.lead.findFirst({
// //     where: { id: leadId, tenantId },
// //     select: { metadata: true },
// //   });
// //   if (!lead) return;

// //   const existingMetadata = lead.metadata || {};
// //   const newMetadata = {
// //     ...existingMetadata,
// //     emailVerification: {
// //       status,
// //       reason,
// //       lastCheckedAt: checkedAt,
// //     },
// //   };

// //   await prisma.lead.update({
// //     where: { id: leadId },
// //     data: { metadata: newMetadata },
// //   });
// // }

// // /**
// //  * POST /api/email-verification/check
// //  * Body: { email: string, leadId?: string }
// //  * If leadId is provided, we also persist the result.
// //  */
// // export async function verifySingleEmailController(req, res, next) {
// //   try {
// //     const { email, leadId } = req.body;
// //     const tenantId = req.user?.tenantId;

// //     if (!email) {
// //       return res.status(400).json({ error: "email is required" });
// //     }

// //     const result = await verifySingleEmail(email);

// //     if (leadId && tenantId) {
// //       await persistVerificationOnLead(leadId, tenantId, result);
// //     }

// //     return res.json({ result });
// //   } catch (err) {
// //     next(err);
// //   }
// // }

// // /**
// //  * POST /api/email-verification/bulk
// //  * Body: { emails: string[], maxBatchSize?: number }
// //  */
// // export async function verifyEmailsBulkController(req, res, next) {
// //   try {
// //     const { emails, maxBatchSize } = req.body;
// //     if (!Array.isArray(emails) || emails.length === 0) {
// //       return res.status(400).json({ error: "emails[] is required" });
// //     }

// //     // Hard safety: limit batch size
// //     const MAX_PER_BATCH = 50; // tune based on infra
// //     const trimmed = emails.slice(0, maxBatchSize || MAX_PER_BATCH);

// //     const results = await verifyEmailsBulk(trimmed, { concurrency: 5 });

// //     // Provide quick summary for UI
// //     const summary = results.reduce(
// //       (acc, r) => {
// //         acc.total++;
// //         acc.byStatus[r.status] = (acc.byStatus[r.status] || 0) + 1;
// //         return acc;
// //       },
// //       { total: 0, byStatus: {} }
// //     );

// //     return res.json({ results, summary, batchSize: trimmed.length });
// //   } catch (err) {
// //     next(err);
// //   }
// // }

// // /**
// //  * POST /api/email-verification/leads
// //  * Body: { leadIds: string[], maxBatchSize?: number }
// //  * Reads primary contactEmail[0] from each lead, verifies, and persists on metadata.
// //  */
// // export async function verifyLeadsBulkController(req, res, next) {
// //   try {
// //     const tenantId = req.user?.tenantId;
// //     const { leadIds, maxBatchSize } = req.body;

// //     if (!tenantId) {
// //       return res.status(401).json({ error: "Tenant context required" });
// //     }
// //     if (!Array.isArray(leadIds) || leadIds.length === 0) {
// //       return res.status(400).json({ error: "leadIds[] is required" });
// //     }

// //     const MAX_PER_BATCH = 50;
// //     const limitedLeadIds = leadIds.slice(0, maxBatchSize || MAX_PER_BATCH);

// //     const leads = await prisma.lead.findMany({
// //       where: {
// //         id: { in: limitedLeadIds },
// //         tenantId,
// //         deletedAt: null,
// //       },
// //       select: {
// //         id: true,
// //         contactEmail: true,
// //       },
// //     });

// //     const emailMap = [];
// //     for (const lead of leads) {
// //       const primaryEmail = (lead.contactEmail || []).find((e) => e && e.trim());
// //       if (!primaryEmail) {
// //         emailMap.push({
// //           leadId: lead.id,
// //           email: null,
// //           error: "No contactEmail on lead",
// //         });
// //       } else {
// //         emailMap.push({ leadId: lead.id, email: primaryEmail });
// //       }
// //     }

// //     const emailsToVerify = emailMap.filter((e) => e.email).map((e) => e.email);
// //     const verificationResults = await verifyEmailsBulk(emailsToVerify, { concurrency: 5 });

// //     // Map back by email
// //     const resultByEmail = new Map();
// //     for (const r of verificationResults) {
// //       resultByEmail.set(r.email, r);
// //     }

// //     const finalResults = [];

// //     for (const entry of emailMap) {
// //       if (!entry.email) {
// //         finalResults.push({
// //           leadId: entry.leadId,
// //           email: null,
// //           status: "UNDELIVERABLE",
// //           reason: entry.error,
// //           checkedAt: new Date().toISOString(),
// //         });
// //         continue;
// //       }

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

// //       // persist on lead.metadata
// //       await persistVerificationOnLead(entry.leadId, tenantId, vr);

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

// //     return res.json({
// //       results: finalResults,
// //       summary,
// //       processedLeadCount: finalResults.length,
// //     });
// //   } catch (err) {
// //     next(err);
// //   }
// // }
