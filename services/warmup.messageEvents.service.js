import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Helper: get "example.com" from "user@example.com"
 */
function getDomainFromEmail(email) {
  if (!email || typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

// UTC date helpers
function startOfDayUtc(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUtc(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d;
}

// Formatting helpers
function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
function percent(rate01) {
  const x = Number(rate01);
  if (!Number.isFinite(x)) return 0;
  return x * 100;
}

// Stats helpers
function sumStatsRows(rows) {
  const out = {
    plannedSends: 0,
    sentCount: 0,
    openCount: 0,
    replyCount: 0,
    bounceCount: 0,
    complaintCount: 0,
    spamFolderCount: 0,
  };

  for (const r of rows || []) {
    out.plannedSends += Number(r.plannedSends || 0);
    out.sentCount += Number(r.sentCount || 0);
    out.openCount += Number(r.openCount || 0);
    out.replyCount += Number(r.replyCount || 0);
    out.bounceCount += Number(r.bounceCount || 0);
    out.complaintCount += Number(r.complaintCount || 0);
    out.spamFolderCount += Number(r.spamFolderCount || 0);
  }

  return out;
}

/**
 * Bayesian smoothing for rates:
 * (success + a) / (trials + a + b)
 */
function bayesianRate(success, trials, a = 1, b = 1) {
  const s = Math.max(0, Number(success || 0));
  const t = Math.max(0, Number(trials || 0));
  const aa = Math.max(0, Number(a || 0));
  const bb = Math.max(0, Number(b || 0));
  return (s + aa) / (t + aa + bb);
}

// Scoring / classification (kept simple + stable)
function clamp01(x) {
  return Math.max(0, Math.min(1, Number(x)));
}

function computeDomainScore({
  deliverabilityRate,
  openRate,
  replyRate,
  bounceRate,
  complaintRate,
  spamPlacementRate,
}) {
  // Normalize into 0..1 where higher is better
  const goodDeliver = clamp01(deliverabilityRate);
  const goodOpen = clamp01(openRate);
  const goodReply = clamp01(replyRate);

  const badBounce = clamp01(bounceRate);
  const badComplaint = clamp01(complaintRate);
  const badSpam = clamp01(spamPlacementRate);

  // Weighted score (0..100)
  const score01 =
    0.45 * goodDeliver +
    0.20 * goodOpen +
    0.15 * goodReply +
    0.10 * (1 - badBounce) +
    0.05 * (1 - badComplaint) +
    0.05 * (1 - badSpam);

  return Math.round(clamp01(score01) * 100);
}

function classifyDomain(score) {
  const s = Number(score || 0);
  if (s >= 75) return "HEALTHY";
  if (s >= 50) return "AT_RISK";
  return "CRITICAL";
}

function buildIssueList({ bounceRate, complaintRate, spamPlacementRate }) {
  const issues = [];

  // These thresholds are conservative defaults
  if (Number(bounceRate) >= 0.05) {
    issues.push({
      code: "HIGH_BOUNCE",
      label: "High bounce rate",
      severity: "HIGH",
    });
  } else if (Number(bounceRate) >= 0.02) {
    issues.push({
      code: "ELEVATED_BOUNCE",
      label: "Elevated bounce rate",
      severity: "MEDIUM",
    });
  }

  if (Number(complaintRate) >= 0.003) {
    issues.push({
      code: "HIGH_COMPLAINT",
      label: "High complaint rate",
      severity: "HIGH",
    });
  } else if (Number(complaintRate) >= 0.001) {
    issues.push({
      code: "ELEVATED_COMPLAINT",
      label: "Elevated complaint rate",
      severity: "MEDIUM",
    });
  }

  if (Number(spamPlacementRate) >= 0.02) {
    issues.push({
      code: "SPAM_PLACEMENT",
      label: "Spam placement detected",
      severity: "HIGH",
    });
  } else if (Number(spamPlacementRate) >= 0.01) {
    issues.push({
      code: "ELEVATED_SPAM_PLACEMENT",
      label: "Elevated spam placement",
      severity: "MEDIUM",
    });
  }

  return issues;
}

/**
 * ✅ Fully corrected, Prisma-safe, same output format
 */
export async function buildDeliverabilityReportForWarmupProfile({
  tenantId,
  warmupProfileId,
}) {
  // 1) Load profile + identity + domain
  const warmupProfile = await prisma.emailWarmupProfile.findFirst({
    where: { id: warmupProfileId, tenantId },
    select: {
      id: true,
      tenantId: true,
      emailIdentityId: true,
      status: true,
      EmailIdentity: {
        select: {
          id: true,
          emailAddress: true,
          verificationStatus: true,
          DomainIdentity: {
            select: {
              domainName: true,
            },
          },
        },
      },
    },
  });

  if (!warmupProfile) {
    throw new Error("Warmup profile not found for this tenant.");
  }

  if (!warmupProfile.emailIdentityId) {
    throw new Error("Warmup profile is missing emailIdentityId.");
  }

  const emailAddress = warmupProfile?.EmailIdentity?.emailAddress || null;

  const domain =
    (warmupProfile?.EmailIdentity?.DomainIdentity?.domainName
      ? String(warmupProfile.EmailIdentity.DomainIdentity.domainName).toLowerCase()
      : null) || getDomainFromEmail(emailAddress);

  // 2) Determine date windows (last 30 days + previous 30 days for deltas)
  const todayUtc = startOfDayUtc(new Date());
  const windowEndExclusive = addDaysUtc(todayUtc, 1);
  const windowStartInclusive = addDaysUtc(todayUtc, -DEFAULT_WINDOW_DAYS + 1);

  const previousWindowEndExclusive = addDaysUtc(windowStartInclusive, 0);
  const previousWindowStartInclusive = addDaysUtc(
    windowStartInclusive,
    -DEFAULT_WINDOW_DAYS
  );

  // 3) Fetch daily stats rows
  const [currentRows, previousRows] = await Promise.all([
    prisma.warmupDailyStat.findMany({
      where: {
        tenantId,
        emailIdentityId: warmupProfile.emailIdentityId,
        date: { gte: windowStartInclusive, lt: windowEndExclusive },
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        plannedSends: true,
        sentCount: true,
        openCount: true,
        replyCount: true,
        bounceCount: true,
        complaintCount: true,
        spamFolderCount: true,
      },
    }),
    prisma.warmupDailyStat.findMany({
      where: {
        tenantId,
        emailIdentityId: warmupProfile.emailIdentityId,
        date: { gte: previousWindowStartInclusive, lt: previousWindowEndExclusive },
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        plannedSends: true,
        sentCount: true,
        openCount: true,
        replyCount: true,
        bounceCount: true,
        complaintCount: true,
        spamFolderCount: true,
      },
    }),
  ]);

  const currentTotals = sumStatsRows(currentRows);
  const previousTotals = sumStatsRows(previousRows);

  // 4) Compute smoothed KPI rates (current + previous)
  const currentSent = currentTotals.sentCount;
  const previousSent = previousTotals.sentCount;

  // Delivered = sent - bounces (minimum viable)
  const currentDeliveredCount = Math.max(
    currentTotals.sentCount - currentTotals.bounceCount,
    0
  );
  const previousDeliveredCount = Math.max(
    previousTotals.sentCount - previousTotals.bounceCount,
    0
  );

  // Smoothed rates
  const deliverabilityRate = bayesianRate(
    currentDeliveredCount,
    currentSent,
    5,
    2
  );
  const bounceRate = bayesianRate(currentTotals.bounceCount, currentSent, 2, 20);
  const complaintRate = bayesianRate(
    currentTotals.complaintCount,
    currentSent,
    1,
    400
  );
  const spamPlacementRate = bayesianRate(
    currentTotals.spamFolderCount,
    currentSent,
    1,
    150
  );

  const openRate = bayesianRate(currentTotals.openCount, currentSent, 2, 8);
  const replyRate = bayesianRate(currentTotals.replyCount, currentSent, 1, 20);

  // Previous window rates for delta
  const prevDeliverabilityRate = bayesianRate(
    previousDeliveredCount,
    previousSent,
    5,
    2
  );
  const prevBounceRate = bayesianRate(previousTotals.bounceCount, previousSent, 2, 20);
  const prevComplaintRate = bayesianRate(
    previousTotals.complaintCount,
    previousSent,
    1,
    400
  );
  const prevSpamPlacementRate = bayesianRate(
    previousTotals.spamFolderCount,
    previousSent,
    1,
    150
  );

  // 5) Domain score + health classification
  const domainScore = computeDomainScore({
    deliverabilityRate,
    openRate,
    replyRate,
    bounceRate,
    complaintRate,
    spamPlacementRate,
  });

  const domainStatus = classifyDomain(domainScore);
  const issues = buildIssueList({
    bounceRate,
    complaintRate,
    spamPlacementRate,
  });

  // 6) Time-series for "Performance Over Time"
  const performanceSeries = (currentRows || []).map((row) => {
    const sentCount = Number(row.sentCount || 0);
    const bounceCount = Number(row.bounceCount || 0);
    const spamFolderCount = Number(row.spamFolderCount || 0);

    const deliveredCount = Math.max(sentCount - bounceCount, 0);

    return {
      date: row.date,
      delivered: deliveredCount,
      spam: spamFolderCount,
      sent: sentCount,
    };
  });

  // 7) Build response for UI modules (✅ same output format)
  const response = {
    profile: {
      warmupProfileId: warmupProfile.id,
      emailIdentityId: warmupProfile.emailIdentityId,
      emailAddress,
      domain,
      status: warmupProfile.status || null,
      windowDays: DEFAULT_WINDOW_DAYS,
    },

    // KPI cards (top row)
    overview: {
      deliverabilityRate: {
        value: percent(deliverabilityRate),
        delta: round2(percent(deliverabilityRate) - percent(prevDeliverabilityRate)),
      },
      bounceRate: {
        value: percent(bounceRate),
        delta: round2(percent(bounceRate) - percent(prevBounceRate)),
      },
      complaintRate: {
        value: percent(complaintRate),
        delta: round2(percent(complaintRate) - percent(prevComplaintRate)),
      },
      spamTrapHits: {
        value: currentTotals.spamFolderCount,
        delta: Number(currentTotals.spamFolderCount - previousTotals.spamFolderCount),
      },
    },

    performanceOverTime: {
      series: performanceSeries,
    },

    domainHealth: {
      totalDomains: domain ? 1 : 0,
      buckets: {
        healthy: domainStatus === "HEALTHY" ? 1 : 0,
        atRisk: domainStatus === "AT_RISK" ? 1 : 0,
        critical: domainStatus === "CRITICAL" ? 1 : 0,
      },
      domains: domain
        ? [
            {
              domain,
              score: domainScore,
              status: domainStatus,
              sent: currentTotals.sentCount,
              delivered: currentDeliveredCount,
              bounceRate: percent(bounceRate),
              complaintRate: percent(complaintRate),
              spamPlacementRate: percent(spamPlacementRate),
            },
          ]
        : [],
    },

    topPerformingDomains: domain
      ? [
          {
            domain,
            score: domainScore,
            sent: currentTotals.sentCount,
          },
        ]
      : [],

    domainsWithIssues:
      domain && issues.length > 0
        ? issues.map((issue) => ({
            domain,
            issue: issue.label,
            code: issue.code,
            severity: issue.severity,
            action: "Fix",
          }))
        : [],

    diagnostics: {
      totals: {
        plannedSends: currentTotals.plannedSends,
        sentCount: currentTotals.sentCount,
        deliveredCount: currentDeliveredCount,
        openCount: currentTotals.openCount,
        replyCount: currentTotals.replyCount,
        bounceCount: currentTotals.bounceCount,
        complaintCount: currentTotals.complaintCount,
        spamFolderCount: currentTotals.spamFolderCount,
      },
      rates: {
        deliverabilityRate: percent(deliverabilityRate),
        openRate: percent(openRate),
        replyRate: percent(replyRate),
        bounceRate: percent(bounceRate),
        complaintRate: percent(complaintRate),
        spamPlacementRate: percent(spamPlacementRate),
      },
    },
  };

  return response;
}



// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();

// const DEFAULT_WINDOW_DAYS = 30;

// /**
//  * Robust rate with Bayesian smoothing.
//  * Prevents "0 or 100%" when volume is tiny.
//  *
//  * smoothedRate = (count + alpha) / (total + alpha + beta)
//  */
// function bayesianRate(count, total, alpha = 1, beta = 1) {
//   const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
//   const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
//   return (safeCount + alpha) / (safeTotal + alpha + beta);
// }

// function clampNumber(value, min, max) {
//   if (!Number.isFinite(value)) return min;
//   if (value < min) return min;
//   if (value > max) return max;
//   return value;
// }

// function percent(value) {
//   // convert 0..1 to percentage number with 1 decimal precision
//   const safe = Number.isFinite(value) ? value : 0;
//   return Math.round(safe * 1000) / 10;
// }

// function round2(value) {
//   const safe = Number.isFinite(value) ? value : 0;
//   return Math.round(safe * 100) / 100;
// }

// function startOfDayUtc(date) {
//   const d = new Date(date);
//   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
// }

// function addDaysUtc(date, days) {
//   const d = new Date(date);
//   d.setUTCDate(d.getUTCDate() + days);
//   return d;
// }

// function getDomainFromEmail(emailAddress) {
//   if (!emailAddress || typeof emailAddress !== "string") return null;
//   const atIndex = emailAddress.indexOf("@");
//   if (atIndex === -1) return null;
//   return emailAddress.slice(atIndex + 1).toLowerCase();
// }

// function buildIssueList({ bounceRate, complaintRate, spamPlacementRate }) {
//   const issues = [];

//   // thresholds can be tuned later
//   if (bounceRate > 0.05) {
//     issues.push({ code: "HIGH_BOUNCE", label: "High Bounce", severity: "warning" });
//   }
//   if (complaintRate > 0.002) {
//     issues.push({ code: "HIGH_COMPLAINT", label: "High Complaint", severity: "critical" });
//   }
//   if (spamPlacementRate > 0.01) {
//     issues.push({ code: "SPAM_PLACEMENT", label: "Spam Placement", severity: "critical" });
//   }

//   return issues;
// }

// /**
//  * Composite domain score (0..100), designed for future extensibility.
//  * Uses smoothed rates and penalizes complaints/spam.
//  */
// function computeDomainScore({
//   deliverabilityRate,
//   openRate,
//   replyRate,
//   bounceRate,
//   complaintRate,
//   spamPlacementRate,
// }) {
//   // penalize complaints/spam more strongly
//   const complaintPenalty = clampNumber(complaintRate * 10, 0, 1); // 0.2% -> 0.02
//   const spamPenalty = clampNumber(spamPlacementRate * 8, 0, 1);

//   const deliverabilityComponent = clampNumber(deliverabilityRate, 0, 1);
//   const engagementComponent = clampNumber(openRate, 0, 1);
//   const replyComponent = clampNumber(replyRate, 0, 1);

//   const bouncePenalty = clampNumber(bounceRate * 4, 0, 1);

//   // Weighted composite score
//   const rawScore =
//     100 *
//     (
//       0.45 * deliverabilityComponent +
//       0.20 * engagementComponent +
//       0.10 * replyComponent +
//       0.15 * (1 - complaintPenalty) +
//       0.10 * (1 - spamPenalty) -
//       0.10 * bouncePenalty
//     );

//   return Math.round(clampNumber(rawScore, 0, 100));
// }

// function classifyDomain(score) {
//   if (score >= 85) return "HEALTHY";
//   if (score >= 70) return "AT_RISK";
//   return "CRITICAL";
// }

// function sumStatsRows(rows) {
//   return rows.reduce(
//     (acc, row) => {
//       acc.plannedSends += Number(row.plannedSends || 0);
//       acc.sentCount += Number(row.sentCount || 0);
//       acc.openCount += Number(row.openCount || 0);
//       acc.replyCount += Number(row.replyCount || 0);
//       acc.bounceCount += Number(row.bounceCount || 0);
//       acc.complaintCount += Number(row.complaintCount || 0);
//       acc.spamFolderCount += Number(row.spamFolderCount || 0);
//       return acc;
//     },
//     {
//       plannedSends: 0,
//       sentCount: 0,
//       openCount: 0,
//       replyCount: 0,
//       bounceCount: 0,
//       complaintCount: 0,
//       spamFolderCount: 0,
//     }
//   );
// }

// /**
//  * MAIN: builds deliverability report for a selected warmup profile.
//  *
//  * Returns a stable response shape for your UI modules.
//  */
// export async function buildDeliverabilityReportForWarmupProfile({ tenantId, warmupProfileId }) {
//   // 1) Load profile + identity
//   // ---- rename model names here if yours differ ----
//   const warmupProfile = await prisma.emailWarmupProfile.findFirst({
//     where: { id: warmupProfileId, tenantId },
//     select: {
//       id: true,
//       tenantId: true,
//       emailIdentityId: true,
//       status: true,
//       EmailIdentity: {
//         select: {
//           id: true,
//           emailAddress: true,
//           domain: true, // if not present in schema, Prisma will error -> remove this line
//         },
//       },
//     },
//   });

//   if (!warmupProfile) {
//     throw new Error("Warmup profile not found for this tenant.");
//   }

//   const emailAddress = warmupProfile?.EmailIdentity?.emailAddress || null;
//   const domain =
//     (warmupProfile?.EmailIdentity?.domain && String(warmupProfile.EmailIdentity.domain).toLowerCase()) ||
//     getDomainFromEmail(emailAddress);

//   if (!warmupProfile.emailIdentityId) {
//     throw new Error("Warmup profile is missing emailIdentityId.");
//   }

//   // 2) Determine date windows (last 30 days + previous 30 days for deltas)
//   const todayUtc = startOfDayUtc(new Date());
//   const windowEndExclusive = addDaysUtc(todayUtc, 1);
//   const windowStartInclusive = addDaysUtc(todayUtc, -DEFAULT_WINDOW_DAYS + 1);

//   const previousWindowEndExclusive = addDaysUtc(windowStartInclusive, 0);
//   const previousWindowStartInclusive = addDaysUtc(windowStartInclusive, -DEFAULT_WINDOW_DAYS);

//   // 3) Fetch daily stats rows
//   // ---- rename model name here if yours differ ----
//   const [currentRows, previousRows] = await Promise.all([
//     prisma.warmupDailyStat.findMany({
//       where: {
//         tenantId,
//         emailIdentityId: warmupProfile.emailIdentityId,
//         date: { gte: windowStartInclusive, lt: windowEndExclusive },
//       },
//       orderBy: { date: "asc" },
//       select: {
//         date: true,
//         plannedSends: true,
//         sentCount: true,
//         openCount: true,
//         replyCount: true,
//         bounceCount: true,
//         complaintCount: true,
//         spamFolderCount: true,
//       },
//     }),
//     prisma.warmupDailyStat.findMany({
//       where: {
//         tenantId,
//         emailIdentityId: warmupProfile.emailIdentityId,
//         date: { gte: previousWindowStartInclusive, lt: previousWindowEndExclusive },
//       },
//       orderBy: { date: "asc" },
//       select: {
//         date: true,
//         plannedSends: true,
//         sentCount: true,
//         openCount: true,
//         replyCount: true,
//         bounceCount: true,
//         complaintCount: true,
//         spamFolderCount: true,
//       },
//     }),
//   ]);

//   const currentTotals = sumStatsRows(currentRows);
//   const previousTotals = sumStatsRows(previousRows);

//   // 4) Compute smoothed KPI rates (current + previous)
//   const currentSent = currentTotals.sentCount;
//   const previousSent = previousTotals.sentCount;

//   // Delivered = sent - bounces (minimum viable)
//   const currentDeliveredCount = Math.max(currentTotals.sentCount - currentTotals.bounceCount, 0);
//   const previousDeliveredCount = Math.max(previousTotals.sentCount - previousTotals.bounceCount, 0);

//   // Smoothed rates
//   const deliverabilityRate = bayesianRate(currentDeliveredCount, currentSent, 5, 2);
//   const bounceRate = bayesianRate(currentTotals.bounceCount, currentSent, 2, 20);
//   const complaintRate = bayesianRate(currentTotals.complaintCount, currentSent, 1, 400);
//   const spamPlacementRate = bayesianRate(currentTotals.spamFolderCount, currentSent, 1, 150);

//   const openRate = bayesianRate(currentTotals.openCount, currentSent, 2, 8);
//   const replyRate = bayesianRate(currentTotals.replyCount, currentSent, 1, 20);

//   // Previous window rates for delta
//   const prevDeliverabilityRate = bayesianRate(previousDeliveredCount, previousSent, 5, 2);
//   const prevBounceRate = bayesianRate(previousTotals.bounceCount, previousSent, 2, 20);
//   const prevComplaintRate = bayesianRate(previousTotals.complaintCount, previousSent, 1, 400);
//   const prevSpamPlacementRate = bayesianRate(previousTotals.spamFolderCount, previousSent, 1, 150);

//   // 5) Domain score + health classification
//   const domainScore = computeDomainScore({
//     deliverabilityRate,
//     openRate,
//     replyRate,
//     bounceRate,
//     complaintRate,
//     spamPlacementRate,
//   });

//   const domainStatus = classifyDomain(domainScore);
//   const issues = buildIssueList({
//     bounceRate,
//     complaintRate,
//     spamPlacementRate,
//   });

//   // 6) Time-series for "Performance Over Time"
//   const performanceSeries = (currentRows || []).map((row) => {
//     const sentCount = Number(row.sentCount || 0);
//     const bounceCount = Number(row.bounceCount || 0);
//     const spamFolderCount = Number(row.spamFolderCount || 0);

//     const deliveredCount = Math.max(sentCount - bounceCount, 0);

//     return {
//       date: row.date,
//       delivered: deliveredCount,
//       spam: spamFolderCount,
//       sent: sentCount,
//     };
//   });

//   // 7) Build response for UI modules
//   const response = {
//     profile: {
//       warmupProfileId: warmupProfile.id,
//       emailIdentityId: warmupProfile.emailIdentityId,
//       emailAddress,
//       domain,
//       status: warmupProfile.status || null,
//       windowDays: DEFAULT_WINDOW_DAYS,
//     },

//     // KPI cards (top row)
//     overview: {
//       deliverabilityRate: {
//         value: percent(deliverabilityRate), // e.g. 98.2
//         delta: round2(percent(deliverabilityRate) - percent(prevDeliverabilityRate)),
//       },
//       bounceRate: {
//         value: percent(bounceRate),
//         delta: round2(percent(bounceRate) - percent(prevBounceRate)),
//       },
//       complaintRate: {
//         value: percent(complaintRate),
//         delta: round2(percent(complaintRate) - percent(prevComplaintRate)),
//       },

//       // For now: "Spam Trap Hits" uses spamFolderCount as a proxy for spam placement.
//       // Later you can add real spam-trap tracking table and swap this field.
//       spamTrapHits: {
//         value: currentTotals.spamFolderCount,
//         delta: Number(currentTotals.spamFolderCount - previousTotals.spamFolderCount),
//       },
//     },

//     // chart module
//     performanceOverTime: {
//       series: performanceSeries,
//     },

//     // donut + lists
//     domainHealth: {
//       totalDomains: domain ? 1 : 0,
//       buckets: {
//         healthy: domainStatus === "HEALTHY" ? 1 : 0,
//         atRisk: domainStatus === "AT_RISK" ? 1 : 0,
//         critical: domainStatus === "CRITICAL" ? 1 : 0,
//       },
//       domains: domain
//         ? [
//             {
//               domain,
//               score: domainScore,
//               status: domainStatus,
//               sent: currentTotals.sentCount,
//               delivered: currentDeliveredCount,
//               bounceRate: percent(bounceRate),
//               complaintRate: percent(complaintRate),
//               spamPlacementRate: percent(spamPlacementRate),
//             },
//           ]
//         : [],
//     },

//     topPerformingDomains: domain
//       ? [
//           {
//             domain,
//             score: domainScore,
//             sent: currentTotals.sentCount,
//           },
//         ]
//       : [],

//     domainsWithIssues: domain && issues.length > 0
//       ? issues.map((issue) => ({
//           domain,
//           issue: issue.label,
//           code: issue.code,
//           severity: issue.severity,
//           action: "Fix", // UI can show "Fix"
//         }))
//       : [],

//     // Extra data to help future UI
//     diagnostics: {
//       totals: {
//         plannedSends: currentTotals.plannedSends,
//         sentCount: currentTotals.sentCount,
//         deliveredCount: currentDeliveredCount,
//         openCount: currentTotals.openCount,
//         replyCount: currentTotals.replyCount,
//         bounceCount: currentTotals.bounceCount,
//         complaintCount: currentTotals.complaintCount,
//         spamFolderCount: currentTotals.spamFolderCount,
//       },
//       rates: {
//         deliverabilityRate: percent(deliverabilityRate),
//         openRate: percent(openRate),
//         replyRate: percent(replyRate),
//         bounceRate: percent(bounceRate),
//         complaintRate: percent(complaintRate),
//         spamPlacementRate: percent(spamPlacementRate),
//       },
//     },
//   };

//   return response;
// }
