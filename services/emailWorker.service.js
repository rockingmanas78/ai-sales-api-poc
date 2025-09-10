// bulkEmailWorker.js
import { PrismaClient } from "@prisma/client";
import mustache from "mustache";
import { sendEmail } from "./ses.service.js";

const prisma = new PrismaClient();

const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);
const WINDOWS = Number(process.env.WINDOWS_PER_HOUR || 6);
const WINDOW_MS = (60 * 60 * 1000) / WINDOWS;
const MAX_ATTEMPTS = Number(process.env.MAX_EMAIL_ATTEMPTS || 3);

export async function processNextBatch() {
  console.log("▶ Processing next batch");
  const now = new Date();

  // 1️⃣ pick ONE due job (row-lock prevents races)
  const [job] = await prisma.$queryRaw`
    UPDATE "BulkEmailJob"
    SET
      status = 'PROCESSING',
      "lastProcessedAt" = ${now}
    WHERE id = (
      SELECT id FROM "BulkEmailJob"
      WHERE status IN ('QUEUED','PROCESSING')
        AND "nextProcessTime" <= ${now}
      ORDER BY "nextProcessTime"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;
  console.log(job);
  if (!job) return;

  // 2️⃣ load full job + template + variables
  const fullJob = await prisma.bulkEmailJob.findUnique({
    where: { id: job.id },
    include: {
      template: {
        include: { variable: true },
      },
    },
  });

  console.log("Full job", fullJob);

  // calculate how many you can send this window
  const batchSize = Math.ceil(fullJob.rateLimit / WINDOWS);

  // 3️⃣ pull next leads
  const leads = await prisma.bulkEmailJobLead.findMany({
    where: { jobId: job.id, status: "QUEUED" },
    include: { lead: true },
    take: batchSize,
    orderBy: { id: "asc" },
  });

  console.log("lead", leads);

  // if no leads left → finish up
  if (leads.length === 0) {
    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: now },
    });
    if (fullJob.campaignId) {
      await prisma.emailCampaign.update({
        where: { id: fullJob.campaignId },
        data: { status: "COMPLETED" },
      });
    }
    return;
  }

  console.log("Leads", leads);
  console.log("batchSize", batchSize);

  // 4️⃣ render & send via your sendEmail() service
  const sendResults = await Promise.all(
    leads.map(async (jl) => {
      const { lead } = jl;
      const payloadVars = {
        ...lead,
        // if you have custom variable defaults, merge them here
      };
      const renderedSubject = mustache.render(
        fullJob.template.subject,
        payloadVars
      );
      const renderedHtml = mustache.render(fullJob.template.body, payloadVars);

      console.log("renderedSubject", renderedSubject);
      console.log("renderedHtml", renderedHtml);

      try {
        await sendEmail({
          fromEmail: fullJob.template.from,
          toEmail: lead.contactEmail[0],
          subject: renderedSubject,
          htmlBody: renderedHtml,
          // configurationSetName: fullJob.configurationSetName, // if you track per-job/campaign
        });
        return {
          jlId: jl.id,
          leadId: lead.id,
          status: "SENT",
          attempts: jl.attempts + 1,
        };
      } catch (err) {
        console.error("Error sending to", lead.contactEmail[0], err);
        return {
          jlId: jl.id,
          leadId: lead.id,
          status: "FAILED",
          attempts: jl.attempts + 1,
        };
      }
    })
  );

  // 5️⃣ persist all outcomes in one transaction
  await prisma.$transaction(async (tx) => {
    for (const r of sendResults) {
      const stillHasRetries =
        r.status === "FAILED" && r.attempts < MAX_ATTEMPTS;

      await tx.bulkEmailJobLead.update({
        where: { id: r.jlId },
        data: {
          status: stillHasRetries ? "QUEUED" : r.status,
          attempts: { increment: 1 },
          sentAt: r.status === "SENT" ? now : undefined,
        },
      });
      await tx.emailMessage.create({
        data: {
          tenantId: fullJob.tenantId,
          conversationId: null, // bulk sends usually aren’t threaded
          direction: "OUTBOUND",
          provider: "AWS_SES",
          providerMessageId: null, // fill later if SES returns MessageId
          subject: fullJob.template.subject,
          from: [fullJob.template.from],
          to: [lead.contactEmail[0]],
          html: fullJob.template.body,
          plusToken: null,
          sentAt: r.status === "SENT" ? now : null,
          campaignId: fullJob.campaignId,
          leadId: r.leadId,
          verdicts: {},
          headers: {},
        },
      });
    }

    // recalc progress & schedule next window
    const processed = await tx.bulkEmailJobLead.count({
      where: { jobId: job.id, status: { not: "QUEUED" } },
    });
    const stillQueued = fullJob.total - processed;

    await tx.bulkEmailJob.update({
      where: { id: job.id },
      data: {
        progress: processed,
        status: stillQueued ? "QUEUED" : "COMPLETED",
        nextProcessTime: stillQueued
          ? new Date(now.getTime() + WINDOW_MS)
          : null,
        completedAt: stillQueued ? null : now,
      },
    });

    // update campaign state as well
    if (fullJob.campaignId) {
      await tx.emailCampaign.update({
        where: { id: fullJob.campaignId },
        data: { status: stillQueued ? "ACTIVE" : "COMPLETED" },
      });
    }
  });
}

// Bootstraps the polling loop; no manual intervention needed
export function startEmailWorker() {
  console.log("▶ Email worker started");
  processNextBatch().catch(console.error);
  const id = setInterval(
    () => processNextBatch().catch(console.error),
    POLL_MS
  );

  // clean shutdown
  const shutdown = () => {
    clearInterval(id);
    prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown).on("SIGTERM", shutdown);
}

// import { PrismaClient } from '@prisma/client';
// const prisma = new PrismaClient();
// import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
// import mustache from "mustache";           // for {{var}} replacement

// const ses = new SESClient({ region: process.env.AWS_REGION });
// const POLL_MS   = Number(process.env.POLL_INTERVAL_MS || 60_000);
// const WINDOWS   = Number(process.env.WINDOWS_PER_HOUR   || 6);
// const WINDOW_MS = 60 * 60 * 1000 / WINDOWS;             // per poll window

// export async function processNextBatch() {
//   const now = new Date();

//   // 1️⃣ pick ONE job whose nextProcessTime ≤ now (row‑lock prevents races)
//     const [job] = await prisma.$queryRaw`
//     UPDATE "BulkEmailJob"
//     SET
//         status = 'PROCESSING',
//         "lastProcessedAt" = ${now}
//     WHERE id = (
//         SELECT id
//         FROM "BulkEmailJob"
//         WHERE status IN ('QUEUED','PROCESSING')
//         AND "nextProcessTime" <= ${now}
//         ORDER BY "nextProcessTime"
//         LIMIT 1
//         FOR UPDATE SKIP LOCKED
//     )
//     RETURNING *;
//     `;
//     console.log(job);
//   if (!job) return;                    // nothing ready this tick

//   // 2️⃣ hydrate template + parent campaign in one query
//   const fullJob = await prisma.bulkEmailJob.findUnique({
//     where: { id: job.id },
//     include: { template: { include: { variable: true } } }
//   });
//   const batchSize = Math.ceil(fullJob.rateLimit / WINDOWS);

//   // 3️⃣ pull up to batchSize queued leads
//   const leads = await prisma.bulkEmailJobLead.findMany({
//     where : { jobId: job.id, status: 'QUEUED' },
//     include: { lead: true },
//     take  : batchSize,
//     orderBy: { id: "asc" }
//   });

//   if (leads.length === 0) {
//     // DONE ➜ mark completed + bubble up
//     await prisma.bulkEmailJob.update({
//       where: { id: job.id },
//       data : { status: 'COMPLETED', completedAt: now }
//     });
//     if (fullJob.campaignId) {
//       await prisma.emailCampaign.update({
//         where: { id: fullJob.campaignId },
//         data : { status: 'COMPLETED' }
//       });
//     }
//     return;
//   }

//   // 4️⃣ send each mail & collect outcomes
//   const sendResults = await Promise.all(leads.map(async jl => {
//     const { lead } = jl;
//     try {
//       const renderedSubject = mustache.render(fullJob.template.subject, lead);
//       const renderedHtml    = mustache.render(fullJob.template.body,    lead);

//       await ses.send(new SendEmailCommand({
//         Destination: { ToAddresses: [lead.contactEmail[0]] },
//         Message: {
//           Subject: { Data: renderedSubject },
//           Body   : { Html: { Data: renderedHtml } }
//         },
//         Source: fullJob.template.from
//       }));
//       return { jlId: jl.id, leadId: lead.id, status: "SENT" };
//     } catch (err) {
//       console.error("SES error", err);
//       return { jlId: jl.id, leadId: lead.id, status: "FAILED" };
//     }
//   }));

//   // 5️⃣ database updates in *one* transaction for durability
//   await prisma.$transaction(async tx => {
//     for (const r of sendResults) {
//       await tx.bulkEmailJobLead.update({
//         where: { id: r.jlId },
//         data : {
//           status: r.status,
//           attempts: { increment: 1 },
//           sentAt: r.status === "SENT" ? now : undefined
//         }
//       });
//       await tx.emailLog.create({
//         data: {
//           tenantId  : fullJob.tenantId,
//           campaignId: fullJob.campaignId,
//           leadId    : r.leadId,
//           status    : r.status,
//           sentAt    : r.status === "SENT" ? now : undefined
//         }
//       });
//     }

//     // progress + schedule next window
//     const processed = await tx.bulkEmailJobLead.count({
//       where: { jobId: job.id, status: { not: 'QUEUED' } }
//     });
//     const stillQueued = fullJob.total - processed;

//     await tx.bulkEmailJob.update({
//       where: { id: job.id },
//       data : {
//         progress        : processed,
//         status          : stillQueued ? 'QUEUED' : 'COMPLETED',
//         nextProcessTime : stillQueued ? new Date(now.getTime() + WINDOW_MS) : null,
//         completedAt     : stillQueued ? null : now
//       }
//     });

//     if (fullJob.campaignId) {
//       await tx.emailCampaign.update({
//         where: { id: fullJob.campaignId },
//         data : { status: stillQueued ? 'ACTIVE' : 'COMPLETED' }
//       });
//     }
//   });
// }

// // exported starter
// export function startEmailWorker() {
//   console.log("▶ Email worker started");
//   processNextBatch().catch(console.error);
//   const id = setInterval(() => processNextBatch().catch(console.error), POLL_MS);

//   // clean shutdown
//   const shutdown = () => { clearInterval(id); prisma.$disconnect(); process.exit(0); };
//   process.on("SIGTERM", shutdown).on("SIGINT", shutdown);
// }
