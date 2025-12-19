import { PrismaClient } from "@prisma/client";
import { safeLowercaseEmail } from "./warmup.utils.service.js";

const prisma = new PrismaClient();

/**
 * Count warmup OUTBOUND messages sent to a warmup inbox today
 * ✅ Uses WarmupMessage (NOT EmailMessage)
 */
async function countWarmupMessagesSentToInboxToday({
  inboxEmail,
  startOfDayUtc,
}) {
  return prisma.warmupMessage.count({
    where: {
      direction: "OUTBOUND",
      sentAt: { gte: startOfDayUtc },
      to: { has: inboxEmail },
    },
  });
}

/**
 * Pick an eligible warmup inbox respecting maxDailyVolume
 */
export async function pickEligibleWarmupInbox({ startOfDayUtc }) {
  const candidates = await prisma.warmupInbox.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      email: true,
      maxDailyVolume: true,
      autoEngagementEnabled: true,
      domain: true,
      provider: true,
    },
  });

  if (!candidates.length) return null;

  // Prefer inboxes with auto-engagement enabled
  const sortedCandidates = [
    ...candidates.filter((c) => c.autoEngagementEnabled),
    ...candidates.filter((c) => !c.autoEngagementEnabled),
  ];

  for (const candidate of sortedCandidates) {
    const normalizedEmail = safeLowercaseEmail(candidate.email);

    const sentCountToday = await countWarmupMessagesSentToInboxToday({
      inboxEmail: normalizedEmail,
      startOfDayUtc,
    });

    if (sentCountToday < (candidate.maxDailyVolume || 100)) {
      return { ...candidate, email: normalizedEmail };
    }
  }

  return null;
}
