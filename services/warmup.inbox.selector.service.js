import { PrismaClient } from "@prisma/client";
import { safeLowercaseEmail } from "./warmup.utils.service.js";

const prisma = new PrismaClient();

/**
 * Returns start of UTC day for the provided Date
 */
function getStartOfUtcDateOnly(dateObject) {
  const dateValue = dateObject instanceof Date ? dateObject : new Date();
  return new Date(
    Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate())
  );
}

/**
 * Pick an eligible warmup inbox for a given profile mapping (WarmupProfileInbox),
 * respecting:
 *  - WarmupProfileInbox.status = ACTIVE
 *  - WarmupInbox.status = ACTIVE
 *  - WarmupInbox.maxDailyVolume using WarmupInboxDailyCounter.planned (preferred)
 *
 * NOTE:
 * Scheduler has an advisory lock, so planned increments won't race from multiple schedulers.
 */
export async function pickEligibleWarmupInbox({
  tenantId,
  profileId,
  startOfDayUtc,
}) {
  if (!tenantId || !profileId) return null;

  const startOfDayUtcDateOnly = getStartOfUtcDateOnly(startOfDayUtc);

  // 1) Fetch profile->inbox mappings (only ACTIVE mappings), including the WarmupInbox row
  const profileInboxMappings = await prisma.warmupProfileInbox.findMany({
    where: {
      tenant_id: tenantId,
      profile_id: profileId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      weight: true,
      warmup_inbox_id: true,
      WarmupInbox: {
        select: {
          id: true,
          email: true,
          maxDailyVolume: true,
          autoEngagementEnabled: true,
          domain: true,
          provider: true,
          status: true,
        },
      },
    },
  });

  if (!profileInboxMappings.length) return null;

  // 2) Filter out any mappings whose WarmupInbox is not ACTIVE
  const activeInboxCandidates = profileInboxMappings
    .filter((mapping) => mapping?.WarmupInbox?.status === "ACTIVE")
    .map((mapping) => {
      const inboxRow = mapping.WarmupInbox;

      return {
        warmupProfileInboxId: mapping.id,
        warmupInboxId: inboxRow.id,
        email: safeLowercaseEmail(inboxRow.email),
        maxDailyVolume: Number(inboxRow.maxDailyVolume || 100),
        autoEngagementEnabled: Boolean(inboxRow.autoEngagementEnabled),
        domain: inboxRow.domain,
        provider: inboxRow.provider,
        weight: Number(mapping.weight || 1),
      };
    });

  if (!activeInboxCandidates.length) return null;

  // 3) Fetch today's counters in one query
  const warmupInboxIdList = activeInboxCandidates.map((candidate) => candidate.warmupInboxId);

  const dailyCounters = await prisma.warmupInboxDailyCounter.findMany({
    where: {
      warmup_inbox_id: { in: warmupInboxIdList },
      date: startOfDayUtcDateOnly,
    },
    select: {
      warmup_inbox_id: true,
      planned: true,
      sent: true,
    },
  });

  const counterByWarmupInboxId = new Map(
    dailyCounters.map((counterRow) => [
      counterRow.warmup_inbox_id,
      {
        planned: Number(counterRow.planned || 0),
        sent: Number(counterRow.sent || 0),
      },
    ])
  );

  // 4) Sort candidates:
  //    - prefer autoEngagementEnabled inboxes
  //    - randomize order while slightly respecting mapping weight
  //
  // Minimal & predictable approach:
  // For each candidate, compute a random score scaled by weight.
  const candidatesWithScore = activeInboxCandidates.map((candidate) => {
    const normalizedWeight = Number.isFinite(candidate.weight) && candidate.weight > 0 ? candidate.weight : 1;
    const randomScore = Math.random() * normalizedWeight;

    return { ...candidate, randomScore };
  });

  const prioritizedCandidates = candidatesWithScore.sort((left, right) => {
    const leftAuto = left.autoEngagementEnabled ? 1 : 0;
    const rightAuto = right.autoEngagementEnabled ? 1 : 0;

    if (leftAuto !== rightAuto) return rightAuto - leftAuto; // auto first
    return right.randomScore - left.randomScore; // then weighted random
  });

  // 5) Find the first candidate that is still under daily capacity
  for (const candidate of prioritizedCandidates) {
    const counter = counterByWarmupInboxId.get(candidate.warmupInboxId) || { planned: 0, sent: 0 };

    const plannedCountToday = Number(counter.planned || 0);
    const dailyLimit = Number(candidate.maxDailyVolume || 100);

    // We gate planning by planned count to avoid overscheduling.
    if (plannedCountToday < dailyLimit) {
      return {
        id: candidate.warmupInboxId,
        email: candidate.email,
        maxDailyVolume: dailyLimit,
        autoEngagementEnabled: candidate.autoEngagementEnabled,
        domain: candidate.domain,
        provider: candidate.provider,
        warmupProfileInboxId: candidate.warmupProfileInboxId,
        weight: candidate.weight,
      };
    }
  }

  return null;
}


// import { PrismaClient } from "@prisma/client";
// import { safeLowercaseEmail } from "./warmup.utils.service.js";

// const prisma = new PrismaClient();

// /**
//  * Count warmup OUTBOUND messages sent to a warmup inbox today
//  * ✅ Uses WarmupMessage (NOT EmailMessage)
//  */
// async function countWarmupMessagesSentToInboxToday({
//   inboxEmail,
//   startOfDayUtc,
// }) {
//   return prisma.warmupMessage.count({
//     where: {
//       direction: "OUTBOUND",
//       sentAt: { gte: startOfDayUtc },
//       to: { has: inboxEmail },
//     },
//   });
// }

// /**
//  * Pick an eligible warmup inbox respecting maxDailyVolume
//  */
// export async function pickEligibleWarmupInbox({ startOfDayUtc }) {
//   const candidates = await prisma.warmupInbox.findMany({
//     where: { status: "ACTIVE" },
//     select: {
//       id: true,
//       email: true,
//       maxDailyVolume: true,
//       autoEngagementEnabled: true,
//       domain: true,
//       provider: true,
//     },
//   });

//   if (!candidates.length) return null;

// // 1. Separate into priority tiers
//   const autoEngage = candidates.filter((c) => c.autoEngagementEnabled);
//   const manual = candidates.filter((c) => !c.autoEngagementEnabled);

//   // 2. SHUFFLE function (Fisher-Yates or simple sort)
//   const shuffle = (array) => array.sort(() => Math.random() - 0.5);

//   // 3. Create a randomized list, still preferring auto-engage generally
//   const sortedCandidates = [...shuffle(autoEngage), ...shuffle(manual)];

//   for (const candidate of sortedCandidates) {
//     const normalizedEmail = safeLowercaseEmail(candidate.email);

//     const sentCountToday = await countWarmupMessagesSentToInboxToday({
//        inboxEmail: normalizedEmail,
//        startOfDayUtc,
//      });

//      if (sentCountToday < (candidate.maxDailyVolume || 100)) {
//        return { ...candidate, email: normalizedEmail };
//      }
//   }

//   return null;
// }
