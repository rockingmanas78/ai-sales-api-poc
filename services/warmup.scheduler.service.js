import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import {
  getStartOfTodayUtcDateOnly,
  generateWarmupThreadKey,
  buildWarmupToken,
  buildWarmupReplyToAddress,
  safeLowercaseEmail,
} from "./warmup.utils.service.js";
import { pickEligibleWarmupInbox } from "./warmup.inbox.selector.service.js";
import { pickWarmupSubject, pickWarmupHtmlBody } from "./warmup.content.service.js";

const prisma = new PrismaClient();

/* =====================================================
   Advisory lock (prevents parallel schedulers)
===================================================== */
async function tryAcquireSchedulerLock() {
  const lockKey = 910022;
  const result =
    await prisma.$queryRaw`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`;
  return Boolean(result?.[0]?.acquired);
}

async function releaseSchedulerLock() {
  const lockKey = 910022;
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  } catch {}
}

/* =====================================================
   Helpers
===================================================== */

function shouldAdjustDailyMax(emailWarmupProfile) {
  if (!emailWarmupProfile.lastAdjustedAt) return true;
  const lastAdjustedAtDate = new Date(emailWarmupProfile.lastAdjustedAt);
  const nowDate = new Date();

  return (
    lastAdjustedAtDate.getUTCFullYear() !== nowDate.getUTCFullYear() ||
    lastAdjustedAtDate.getUTCMonth() !== nowDate.getUTCMonth() ||
    lastAdjustedAtDate.getUTCDate() !== nowDate.getUTCDate()
  );
}

async function upsertWarmupDailyStat({ tenantId, emailIdentityId, dateUtc }) {
  return prisma.warmupDailyStat.upsert({
    where: {
      warmup_daily_profile_date_uq: {
        tenantId,
        emailIdentityId,
        date: dateUtc,
      },
    },
    create: {
      tenantId,
      emailIdentityId,
      date: dateUtc,
      plannedSends: 0,
      sentCount: 0,
      openCount: 0,
      replyCount: 0,
      bounceCount: 0,
      complaintCount: 0,
      spamFolderCount: 0,
    },
    update: {},
  });
}

async function countWarmupDraftsCreatedToday({
  tenantId,
  fromEmail,
  startOfDayUtc,
}) {
  return prisma.warmupMessage.count({
    where: {
      tenantId,
      direction: "OUTBOUND",
      createdAt: { gte: startOfDayUtc },
      from: { has: fromEmail },
      providerMessageId: null, // drafts only
    },
  });
}

/**
 * Upsert and increment WarmupInboxDailyCounter.planned for a given inbox/day.
 * Must run inside transaction.
 */
// async function incrementWarmupInboxPlannedCounter({
//   transactionClient,
//   warmupInboxId,
//   dateUtc,
//   tenantId,
// }) {
//   await prisma.warmupInboxDailyCounter.upsert({
//     where: {
//       warmup_inbox_id_date: {
//         warmup_inbox_id: warmupInboxId,
//         date: dateUtcMidnight,
//       },
//     },
//     create: {
//       warmup_inbox_id: warmupInboxId,
//       date: dateUtcMidnight,
//       planned: 1,
//       sent: 0,
//       tenant_id: tenantId,
//     },
//     update: {
//       planned: { increment: 1 },
//       tenant_id: tenantId,
//     },
//   });
// }

function toUtcDateOnly(inputDate) {
  // WarmupInboxDailyCounter.date is @db.Date, so we must store a date-only value.
  // We normalize to UTC date-only (midnight) consistently.
  return getStartOfTodayUtcDateOnly(inputDate || new Date());
}

async function incrementWarmupInboxPlannedCounter({
  transactionClient,
  warmupInboxId,
  dateUtc,
  tenantId,
}) {
  if (!warmupInboxId) return;

  const client = transactionClient || prisma;
  const dateOnlyUtc = toUtcDateOnly(dateUtc);

  await client.warmupInboxDailyCounter.upsert({
    where: {
      // IMPORTANT: Prisma client key is NOT the DB constraint map name.
      // It is generated as warmup_inbox_id_date (compound unique).
      warmup_inbox_id_date: {
        warmup_inbox_id: warmupInboxId,
        date: dateOnlyUtc,
      },
    },
    create: {
      warmup_inbox_id: warmupInboxId,
      date: dateOnlyUtc,
      planned: 1,
      sent: 0,
      tenant_id: tenantId || null,
    },
    update: {
      planned: { increment: 1 },
      ...(tenantId ? { tenant_id: tenantId } : {}),
    },
  });
}

/* =====================================================
   MAIN SCHEDULER
===================================================== */
export async function runWarmupSchedulerTick() {
  const lockKey = 910022;
  const startOfTodayUtc = getStartOfTodayUtcDateOnly();

  return prisma.$transaction(
    async (tx) => {
      const result =
        await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired`;
      const acquired = Boolean(result?.[0]?.acquired);

      console.log("acquired", acquired);
      if (!acquired) {
        return { skipped: true, reason: "scheduler lock not acquired" };
      }

      // ✅ IMPORTANT: use tx.* for ALL prisma calls in this function
      const activeProfiles = await tx.emailWarmupProfile.findMany({
        where: {
          status: "ACTIVE",
          mode: { in: ["AUTO"] },
        },
        include: {
          EmailIdentity: {
            select: { id: true, emailAddress: true, verificationStatus: true },
          },
        },
      });

      let totalDraftsCreated = 0;

      for (const emailWarmupProfile of activeProfiles) {
        const emailIdentityRow = emailWarmupProfile.EmailIdentity;

        if (
          !emailIdentityRow ||
          !["Success", "Verified"].includes(emailIdentityRow.verificationStatus)
        ) {
          continue;
        }

        const tenantId = emailWarmupProfile.tenantId;
        const profileId = emailWarmupProfile.id;
        const fromEmail = safeLowercaseEmail(emailIdentityRow.emailAddress);

        if (
          emailWarmupProfile.mode === "AUTO" &&
          shouldAdjustDailyMax(emailWarmupProfile)
        ) {
          // ✅ computeNextDailyMax must use tx inside (or accept tx)
          const nextDailyMax = await computeNextDailyMax_tx(tx, emailWarmupProfile);

          await tx.emailWarmupProfile.update({
            where: { id: emailWarmupProfile.id },
            data: { currentDailyMax: nextDailyMax, lastAdjustedAt: new Date() },
          });

          emailWarmupProfile.currentDailyMax = nextDailyMax;
        }

        const dailyCap = Number(emailWarmupProfile.currentDailyMax || 0);
        if (dailyCap <= 0) continue;

        const warmupDailyStatRow = await tx.warmupDailyStat.upsert({
          where: {
            warmup_daily_profile_date_uq: {
              tenantId,
              emailIdentityId: emailIdentityRow.id,
              date: startOfTodayUtc,
            },
          },
          create: {
            tenantId,
            emailIdentityId: emailIdentityRow.id,
            date: startOfTodayUtc,
            plannedSends: 0,
            sentCount: 0,
            openCount: 0,
            replyCount: 0,
            bounceCount: 0,
            complaintCount: 0,
            spamFolderCount: 0,
          },
          update: {},
        });

        const alreadyDraftedCount = await tx.warmupMessage.count({
          where: {
            tenantId,
            direction: "OUTBOUND",
            createdAt: { gte: startOfTodayUtc },
            from: { has: fromEmail },
            providerMessageId: null,
          },
        });

        const remainingDraftsToCreate = Math.max(0, dailyCap - alreadyDraftedCount);
        if (!remainingDraftsToCreate) continue;

        for (let draftIndex = 0; draftIndex < remainingDraftsToCreate; draftIndex++) {
          const selectedWarmupInbox = await pickEligibleWarmupInbox({
            tenantId,
            profileId,
            startOfDayUtc: startOfTodayUtc,
          });

          if (!selectedWarmupInbox) break;

          const warmupUuid = generateWarmupThreadKey();
          const warmupToken = buildWarmupToken({ tenantId, warmupUuid });

          const replyDomain = process.env.WARMUP_REPLY_DOMAIN;
          if (!replyDomain) throw new Error("WARMUP_REPLY_DOMAIN not configured");

          const replyToAddress = buildWarmupReplyToAddress({ warmupToken, replyDomain });

          const seedValue = crypto.randomInt(0, 10_000);
          const emailSubject = pickWarmupSubject(seedValue);
          const htmlBody = pickWarmupHtmlBody({
            randomIndex: seedValue,
            senderEmail: fromEmail,
            recipientEmail: selectedWarmupInbox.email,
          });

          const createdThread = await tx.warmupThread.create({
            data: {
              tenantId,
              threadKey: warmupToken,
              profileId: emailWarmupProfile.id,
              inboxId: selectedWarmupInbox.id,
              subject: emailSubject,
              participants: [fromEmail, selectedWarmupInbox.email],
            },
          });

          await tx.warmupMessage.create({
            data: {
              tenantId,
              threadId: createdThread.id,
              direction: "OUTBOUND",
              subject: emailSubject,
              from: [fromEmail],
              to: [selectedWarmupInbox.email],
              html: htmlBody,
              headers: { "Reply-To": replyToAddress, "X-SF-Warmup": "1" },
              warmupMarker: warmupToken,
              configurationSet: process.env.SES_WARMUP_CONFIGURATION_SET,
            },
          });

          await tx.warmupDailyStat.update({
            where: { id: warmupDailyStatRow.id },
            data: { plannedSends: { increment: 1 } },
          });

          await incrementWarmupInboxPlannedCounter({
            transactionClient: tx,
            warmupInboxId: selectedWarmupInbox.id,
            dateUtc: startOfTodayUtc,
            tenantId,
          });

          totalDraftsCreated += 1;
        }
      }

      return { skipped: false, totalDraftsCreated };
    },
    {
      // ✅ Increase these to match your workload
      maxWait: 10_000,   // how long Prisma waits to get a connection
      timeout: 120_000,  // allow up to 2 minutes for the scheduler tick
    }
  );
}

// export async function runWarmupSchedulerTick() {
//   const lockKey = 910022;
//   const startOfTodayUtc = getStartOfTodayUtcDateOnly();

//   return prisma.$transaction(async (tx) => {
//     // ✅ transaction-scoped lock: auto released at end of transaction
//     const result =
//       await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired`;
//     const acquired = Boolean(result?.[0]?.acquired);

//     console.log("acquired", acquired);
//     if (!acquired) {
//       return { skipped: true, reason: "scheduler lock not acquired" };
//     }

//     // -----------------------------
//     // IMPORTANT: use tx. everywhere below (NOT prisma.)
//     // -----------------------------

//     const activeProfiles = await tx.emailWarmupProfile.findMany({
//       where: {
//         status: "ACTIVE",
//         mode: { in: ["AUTO"] },
//       },
//       include: {
//         EmailIdentity: {
//           select: {
//             id: true,
//             emailAddress: true,
//             verificationStatus: true,
//           },
//         },
//       },
//     });

//     let totalDraftsCreated = 0;

//     for (const emailWarmupProfile of activeProfiles) {
//       const emailIdentityRow = emailWarmupProfile.EmailIdentity;

//       if (
//         !emailIdentityRow ||
//         !["Success", "Verified"].includes(emailIdentityRow.verificationStatus)
//       ) {
//         continue;
//       }

//       const tenantId = emailWarmupProfile.tenantId;
//       const profileId = emailWarmupProfile.id;
//       const fromEmail = safeLowercaseEmail(emailIdentityRow.emailAddress);

//       // Adjust daily max (must use tx)
//       if (
//         emailWarmupProfile.mode === "AUTO" &&
//         shouldAdjustDailyMax(emailWarmupProfile)
//       ) {
//         const nextDailyMax = await computeNextDailyMax_tx(tx, emailWarmupProfile);

//         await tx.emailWarmupProfile.update({
//           where: { id: emailWarmupProfile.id },
//           data: {
//             currentDailyMax: nextDailyMax,
//             lastAdjustedAt: new Date(),
//           },
//         });

//         emailWarmupProfile.currentDailyMax = nextDailyMax;
//       }

//       const dailyCap = Number(emailWarmupProfile.currentDailyMax || 0);
//       if (dailyCap <= 0) continue;

//       const warmupDailyStatRow = await upsertWarmupDailyStat_tx(tx, {
//         tenantId,
//         emailIdentityId: emailIdentityRow.id,
//         dateUtc: startOfTodayUtc,
//       });

//       const alreadyDraftedCount = await tx.warmupMessage.count({
//         where: {
//           tenantId,
//           direction: "OUTBOUND",
//           createdAt: { gte: startOfTodayUtc },
//           from: { has: fromEmail },
//           providerMessageId: null,
//         },
//       });

//       const remainingDraftsToCreate = Math.max(0, dailyCap - alreadyDraftedCount);
//       if (!remainingDraftsToCreate) continue;

//       for (let draftIndex = 0; draftIndex < remainingDraftsToCreate; draftIndex++) {
//         const selectedWarmupInbox = await pickEligibleWarmupInbox({
//           tenantId,
//           profileId,
//           startOfDayUtc: startOfTodayUtc,
//         });

//         if (!selectedWarmupInbox) break;

//         const warmupUuid = generateWarmupThreadKey();
//         const warmupToken = buildWarmupToken({ tenantId, warmupUuid });

//         const replyDomain = process.env.WARMUP_REPLY_DOMAIN;
//         if (!replyDomain) throw new Error("WARMUP_REPLY_DOMAIN not configured");

//         const replyToAddress = buildWarmupReplyToAddress({
//           warmupToken,
//           replyDomain,
//         });

//         const seedValue = crypto.randomInt(0, 10_000);
//         const emailSubject = pickWarmupSubject(seedValue);
//         const htmlBody = pickWarmupHtmlBody({
//           randomIndex: seedValue,
//           senderEmail: fromEmail,
//           recipientEmail: selectedWarmupInbox.email,
//         });

//         const createdThread = await tx.warmupThread.create({
//           data: {
//             tenantId,
//             threadKey: warmupToken,
//             profileId: emailWarmupProfile.id,
//             inboxId: selectedWarmupInbox.id,
//             subject: emailSubject,
//             participants: [fromEmail, selectedWarmupInbox.email],
//           },
//         });

//         await tx.warmupMessage.create({
//           data: {
//             tenantId,
//             threadId: createdThread.id,
//             direction: "OUTBOUND",
//             subject: emailSubject,
//             from: [fromEmail],
//             to: [selectedWarmupInbox.email],
//             html: htmlBody,
//             headers: {
//               "Reply-To": replyToAddress,
//               "X-SF-Warmup": "1",
//             },
//             warmupMarker: warmupToken,
//             configurationSet: process.env.SES_WARMUP_CONFIGURATION_SET,
//           },
//         });

//         await tx.warmupDailyStat.update({
//           where: { id: warmupDailyStatRow.id },
//           data: { plannedSends: { increment: 1 } },
//         });

//         await incrementWarmupInboxPlannedCounter({
//           transactionClient: tx,
//           warmupInboxId: selectedWarmupInbox.id,
//           dateUtc: startOfTodayUtc,
//           tenantId,
//         });

//         totalDraftsCreated += 1;
//       }
//     }

//     return { skipped: false, totalDraftsCreated };
//   });
// }

// ---- tx versions of helpers ----

async function upsertWarmupDailyStat_tx(tx, { tenantId, emailIdentityId, dateUtc }) {
  return tx.warmupDailyStat.upsert({
    where: {
      warmup_daily_profile_date_uq: { tenantId, emailIdentityId, date: dateUtc },
    },
    create: {
      tenantId,
      emailIdentityId,
      date: dateUtc,
      plannedSends: 0,
      sentCount: 0,
      openCount: 0,
      replyCount: 0,
      bounceCount: 0,
      complaintCount: 0,
      spamFolderCount: 0,
    },
    update: {},
  });
}

async function computeNextDailyMax_tx(tx, emailWarmupProfile) {
  const currentMax = Number(emailWarmupProfile.currentDailyMax || 0);
  const targetMax = Number(emailWarmupProfile.targetDailyMax || 0);
  const incrementStep = Number(emailWarmupProfile.incrementStep ?? 3);

  if (currentMax >= targetMax) return targetMax;

  const yesterdayDate = utcDateOnlyNDaysAgo(1);

  const yesterdayStats = await tx.warmupDailyStat.findFirst({
    where: {
      tenantId: emailWarmupProfile.tenantId,
      emailIdentityId: emailWarmupProfile.emailIdentityId,
      date: yesterdayDate,
    },
  });

  if (yesterdayStats && Number(yesterdayStats.sentCount || 0) >= 10) {
    const bounceRate =
      Number(yesterdayStats.bounceCount || 0) /
      Math.max(1, Number(yesterdayStats.sentCount || 0));

    if (bounceRate > 0.05) return currentMax;
  }

  return Math.min(currentMax + incrementStep, targetMax);
}

// export async function runWarmupSchedulerTick() {
//   const acquired = await tryAcquireSchedulerLock();
//   console.log("acquired", acquired)
//   if (!acquired) {
//     return { skipped: true, reason: "scheduler lock not acquired" };
//   }

//   const startOfTodayUtc = getStartOfTodayUtcDateOnly();

//   try {
//     const activeProfiles = await prisma.emailWarmupProfile.findMany({
//       where: {
//         status: "ACTIVE",
//         mode: { in: ["AUTO"] },
//       },
//       include: {
//         EmailIdentity: {
//           select: {
//             id: true,
//             emailAddress: true,
//             verificationStatus: true,
//           },
//         },
//       },
//     });

//     console.log("active profiles", activeProfiles);

//     let totalDraftsCreated = 0;

//     for (const emailWarmupProfile of activeProfiles) {
//       const emailIdentityRow = emailWarmupProfile.EmailIdentity;

//       console.log("identity row", emailIdentityRow);

//       if (
//         !emailIdentityRow ||
//         !["Success", "Verified"].includes(emailIdentityRow.verificationStatus)
//       ) {
//         continue;
//       }

//       const tenantId = emailWarmupProfile.tenantId;
//       const profileId = emailWarmupProfile.id;
//       const fromEmail = safeLowercaseEmail(emailIdentityRow.emailAddress);

//       /* Adjust daily max */
//       if (emailWarmupProfile.mode === "AUTO" && shouldAdjustDailyMax(emailWarmupProfile)) {
//         const nextDailyMax = await computeNextDailyMax(emailWarmupProfile);
//         console.log("next daily max", nextDailyMax);

//         await prisma.emailWarmupProfile.update({
//           where: { id: emailWarmupProfile.id },
//           data: {
//             currentDailyMax: nextDailyMax,
//             lastAdjustedAt: new Date(),
//           },
//         });

//         emailWarmupProfile.currentDailyMax = nextDailyMax;
//       }

//       const dailyCap = Number(emailWarmupProfile.currentDailyMax || 0);
//       console.log("dailycap", dailyCap);
//       if (dailyCap <= 0) continue;

//       const warmupDailyStatRow = await upsertWarmupDailyStat({
//         tenantId,
//         emailIdentityId: emailIdentityRow.id,
//         dateUtc: startOfTodayUtc,
//       });

//       const alreadyDraftedCount = await countWarmupDraftsCreatedToday({
//         tenantId,
//         fromEmail,
//         startOfDayUtc: startOfTodayUtc,
//       });

//       const remainingDraftsToCreate = Math.max(0, dailyCap - alreadyDraftedCount);
//       if (!remainingDraftsToCreate) continue;

//       for (let draftIndex = 0; draftIndex < remainingDraftsToCreate; draftIndex++) {
//         // ✅ NEW: profile-scoped selection via WarmupProfileInbox
//         const selectedWarmupInbox = await pickEligibleWarmupInbox({
//           tenantId,
//           profileId,
//           startOfDayUtc: startOfTodayUtc,
//         });

//         if (!selectedWarmupInbox) break;

//         const warmupUuid = generateWarmupThreadKey();
//         const warmupToken = buildWarmupToken({
//           tenantId,
//           warmupUuid,
//         });

//         const replyDomain = process.env.WARMUP_REPLY_DOMAIN;
//         if (!replyDomain) {
//           throw new Error("WARMUP_REPLY_DOMAIN not configured");
//         }

//         const replyToAddress = buildWarmupReplyToAddress({
//           warmupToken,
//           replyDomain,
//         });

//         const seedValue = crypto.randomInt(0, 10_000);
//         const emailSubject = pickWarmupSubject(seedValue);
//         const htmlBody = pickWarmupHtmlBody({
//           randomIndex: seedValue,
//           senderEmail: fromEmail,
//           recipientEmail: selectedWarmupInbox.email,
//         });

//         await prisma.$transaction(async (transactionClient) => {
//           const createdThread = await transactionClient.warmupThread.create({
//             data: {
//               tenantId,
//               threadKey: warmupToken,
//               profileId: emailWarmupProfile.id,
//               inboxId: selectedWarmupInbox.id,
//               subject: emailSubject,
//               participants: [fromEmail, selectedWarmupInbox.email],
//             },
//           });

//           await transactionClient.warmupMessage.create({
//             data: {
//               tenantId,
//               threadId: createdThread.id,
//               direction: "OUTBOUND",
//               subject: emailSubject,
//               from: [fromEmail],
//               to: [selectedWarmupInbox.email],
//               html: htmlBody,
//               headers: {
//                 "Reply-To": replyToAddress,
//                 "X-SF-Warmup": "1",
//               },
//               warmupMarker: warmupToken,
//               configurationSet: process.env.SES_WARMUP_CONFIGURATION_SET,
//             },
//           });

//           // increment profile daily planned
//           await transactionClient.warmupDailyStat.update({
//             where: { id: warmupDailyStatRow.id },
//             data: { plannedSends: { increment: 1 } },
//           });

//           // ✅ NEW: increment inbox daily planned counter
//           await incrementWarmupInboxPlannedCounter({
//             transactionClient,
//             warmupInboxId: selectedWarmupInbox.id,
//             dateUtc: startOfTodayUtc,
//             tenantId,
//           });
//         });

//         totalDraftsCreated += 1;
//       }
//     }

//     return { skipped: false, totalDraftsCreated };
//   } finally {
//     await releaseSchedulerLock();
//   }
// }

function utcDateOnlyNDaysAgo(numberOfDays) {
  const dateValue = new Date();
  dateValue.setUTCDate(dateValue.getUTCDate() - numberOfDays);
  return new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
}

/**
 * SMART RAMP-UP LOGIC
 */
async function computeNextDailyMax(emailWarmupProfile) {
  const currentMax = Number(emailWarmupProfile.currentDailyMax || 0);
  const targetMax = Number(emailWarmupProfile.targetDailyMax || 0);
  const incrementStep = Number(emailWarmupProfile.incrementStep ?? 3);

  if (currentMax >= targetMax) return targetMax;

  const yesterdayDate = utcDateOnlyNDaysAgo(1);

  const yesterdayStats = await prisma.warmupDailyStat.findFirst({
    where: {
      tenantId: emailWarmupProfile.tenantId,
      emailIdentityId: emailWarmupProfile.emailIdentityId,
      date: yesterdayDate,
    },
  });

  if (yesterdayStats && Number(yesterdayStats.sentCount || 0) >= 10) {
    const bounceRate =
      Number(yesterdayStats.bounceCount || 0) / Math.max(1, Number(yesterdayStats.sentCount || 0));

    if (bounceRate > 0.05) {
      console.warn(
        `[Warmup] High bounce rate ${bounceRate.toFixed(3)} for profile=${emailWarmupProfile.id}. Holding daily max at ${currentMax}.`
      );
      return currentMax;
    }
  }

  return Math.min(currentMax + incrementStep, targetMax);
}
