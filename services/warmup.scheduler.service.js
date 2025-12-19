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

function shouldAdjustDailyMax(profile) {
  if (!profile.lastAdjustedAt) return true;
  const last = new Date(profile.lastAdjustedAt);
  const now = new Date();
  return (
    last.getUTCFullYear() !== now.getUTCFullYear() ||
    last.getUTCMonth() !== now.getUTCMonth() ||
    last.getUTCDate() !== now.getUTCDate()
  );
}

function computeNextDailyMax({ currentDailyMax, targetDailyMax }) {
  if (currentDailyMax >= targetDailyMax) return currentDailyMax;
  const increased = Math.ceil(currentDailyMax * 1.1);
  return Math.min(Math.max(increased, currentDailyMax + 1), targetDailyMax);
}

async function upsertDailyStat({ tenantId, profileId, dateUtc }) {
  return prisma.warmupDailyStat.upsert({
    where: {
      warmup_daily_profile_date_uq: {
        tenantId,
        profileId,
        date: dateUtc,
      },
    },
    create: {
      tenantId,
      profileId,
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

/* =====================================================
   MAIN SCHEDULER
===================================================== */

export async function runWarmupSchedulerTick() {
  const acquired = await tryAcquireSchedulerLock();
  if (!acquired) {
    return { skipped: true, reason: "scheduler lock not acquired" };
  }

  const startOfTodayUtc = getStartOfTodayUtcDateOnly();

  try {
    const activeProfiles = await prisma.emailWarmupProfile.findMany({
      where: {
        status: "ACTIVE",
        mode: { in: ["AUTO", "MANUAL_ONLY"] },
      },
      include: {
        EmailIdentity: {
          select: {
            id: true,
            emailAddress: true,
            verificationStatus: true,
          },
        },
      },
    });

    let totalDraftsCreated = 0;

    for (const profile of activeProfiles) {
      if (
        !profile.EmailIdentity ||
        !["Success", "Verified"].includes(
          profile.EmailIdentity.verificationStatus
        )
      ) {
        continue;
      }

      const tenantId = profile.tenantId;
      const fromEmail = safeLowercaseEmail(
        profile.EmailIdentity.emailAddress
      );

      /* Adjust daily max */
      if (profile.mode === "AUTO" && shouldAdjustDailyMax(profile)) {
        const nextDailyMax = computeNextDailyMax({
          currentDailyMax: profile.currentDailyMax,
          targetDailyMax: profile.targetDailyMax,
        });

        await prisma.emailWarmupProfile.update({
          where: { id: profile.id },
          data: {
            currentDailyMax: nextDailyMax,
            lastAdjustedAt: new Date(),
          },
        });

        profile.currentDailyMax = nextDailyMax;
      }

      const dailyCap = profile.currentDailyMax;
      if (dailyCap <= 0) continue;

      const dailyStat = await upsertDailyStat({
        tenantId,
        profileId: profile.id,
        dateUtc: startOfTodayUtc,
      });

      const alreadyDrafted = await countWarmupDraftsCreatedToday({
        tenantId,
        fromEmail,
        startOfDayUtc: startOfTodayUtc,
      });

      const remaining = Math.max(0, dailyCap - alreadyDrafted);
      if (!remaining) continue;

      for (let i = 0; i < remaining; i++) {
        const warmupInbox = await pickEligibleWarmupInbox({
          startOfDayUtc: startOfTodayUtc,
        });
        if (!warmupInbox) break;

        const warmupUuid = generateWarmupThreadKey();
        const warmupToken = buildWarmupToken({
          tenantId,
          warmupUuid,
        });

        const replyDomain = process.env.WARMUP_REPLY_DOMAIN;
        if (!replyDomain) {
          throw new Error("WARMUP_REPLY_DOMAIN not configured");
        }

        const replyTo = buildWarmupReplyToAddress({
          warmupToken,
          replyDomain,
        });

        const seed = crypto.randomInt(0, 10_000);
        const subject = pickWarmupSubject(seed);
        const html = pickWarmupHtmlBody({
          randomIndex: seed,
          senderEmail: fromEmail,
          recipientEmail: warmupInbox.email,
        });

        await prisma.$transaction(async (tx) => {
          const thread = await tx.warmupThread.create({
            data: {
              tenantId,
              threadKey: warmupToken,
              profileId: profile.id,
              inboxId: warmupInbox.id,
              subject,
              participants: [fromEmail, warmupInbox.email],
            },
          });

          await tx.warmupMessage.create({
            data: {
              tenantId,
              threadId: thread.id,
              direction: "OUTBOUND",
              subject,
              from: [fromEmail],
              to: [warmupInbox.email],
              html,
              headers: {
                "Reply-To": replyTo,
                "X-SF-Warmup": "1",
              },
              warmupMarker: warmupToken,
              configurationSet:
                process.env.SES_WARMUP_CONFIGURATION_SET,
            },
          });

          await tx.warmupDailyStat.update({
            where: { id: dailyStat.id },
            data: { plannedSends: { increment: 1 } },
          });
        });

        totalDraftsCreated += 1;
      }
    }

    return { skipped: false, totalDraftsCreated };
  } finally {
    await releaseSchedulerLock();
  }
}
