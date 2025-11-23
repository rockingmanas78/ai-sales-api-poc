import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function computeTenantReputation(tenantId, window = "30d") {
  const from = getFromDate(window);

  // Group events by eventType in the window
  const grouped = await prisma.emailEvent.groupBy({
    by: ["eventType"],
    where: {
      tenantId,
      occurredAt: { gte: from },
    },
    _count: { _all: true },
  });

  const counts = {};
  for (const g of grouped) {
    counts[g.eventType] = g._count._all;
  }

  const sent = counts["SEND"] ?? 0;
  const delivered = counts["DELIVERY"] ?? 0;
  const bounces = counts["BOUNCE"] ?? 0;
  const complaints = counts["COMPLAINT"] ?? 0;
  const rejects = counts["REJECT"] ?? 0;

  const totalEvents = sent + delivered + bounces + complaints + rejects;

  // We’ll use delivered as primary volume indicator
  const MIN_DELIVERED_FOR_SCORING = 100; // adjust as you like
  const MIN_SENT_FOR_SCORING = 100;
  const hasAnyActivity = totalEvents > 0;
  const hasEnoughVolume =
    delivered >= MIN_DELIVERED_FOR_SCORING && sent >= MIN_SENT_FOR_SCORING;

  if (!hasAnyActivity) {
    return {
      tenantId,
      window,
      score: null,
      status: "no_data",
      spamRisk: "unknown",
      confidence: 0,
      metrics: {
        sent,
        delivered,
        bounces,
        complaints,
        rejects,
        opens,
        clicks,
        deliveryRate,
        bounceRate,
        complaintRate,
        openRate,
        clickRate,
        ctor,
        rejectRate,
      },
      subscores: {
        bounceComplaint: null,
        engagement: null,
        infrastructure: null,
        volume: 0,
      },
    };
  }

  // Engagement aggregates
  const engagementAgg = await prisma.emailMessage.aggregate({
    where: {
      tenantId,
      sentAt: { gte: from },
    },
    _sum: {
      opensCount: true,
      clicksCount: true,
    },
  });

  const opens = engagementAgg._sum.opensCount ?? 0;
  const clicks = engagementAgg._sum.clicksCount ?? 0;

  const deliveryRate = sent > 0 ? delivered / sent : 0;
  const bounceRate = sent > 0 ? bounces / sent : 0;
  const complaintRate = sent > 0 ? complaints / sent : 0;
  const openRate = delivered > 0 ? opens / delivered : 0;
  const clickRate = delivered > 0 ? clicks / delivered : 0;
  const ctor = opens > 0 ? clicks / opens : 0;
  const rejectRate = sent > 0 ? rejects / sent : 0;

  function clamp(x) {
    return Math.max(0, Math.min(100, x));
  }

  // Volume-based confidence:
  // - 0 emails => 0
  // - 100 emails => ~60
  // - 1,000 emails => ~85
  // - 10,000+ emails => ~100
  const baselineFor100 = 10000; // delivered emails for full confidence
  const safeDelivered = Math.max(delivered, 0);
  const volumeFactor =
    safeDelivered > 0
      ? Math.log10(safeDelivered + 1) / Math.log10(baselineFor100 + 1)
      : 0;

  const confidence = clamp(100 * volumeFactor);

  // Use confidence also as volume subscore
  const scoreVolume = confidence;

  // Existing subscores as you had them:
  const scoreBounce = clamp(100 * (1 - bounceRate / 0.04));
  const scoreCompl = clamp(100 * (1 - complaintRate / 0.005));
  const scoreBC = 0.5 * scoreBounce + 0.5 * scoreCompl;

  const scoreOpen = clamp(100 * (openRate / 0.2));
  const scoreClick = clamp(100 * (clickRate / 0.02));
  const scoreEng = 0.7 * scoreOpen + 0.3 * scoreClick;

  const scoreDeliv = clamp(100 * (deliveryRate / 0.98));
  const scoreReject = clamp(100 * (1 - rejectRate / 0.01));
  const scoreInfra = 0.7 * scoreDeliv + 0.3 * scoreReject;

  // Use the new scoreVolume from volume/confidence
  const rawFinalScore =
    0.4 * scoreBC + 0.25 * scoreEng + 0.2 * scoreInfra + 0.15 * scoreVolume;

  // Cap final score based on volume:
  // - If delivered < 100 → max 60
  // - If delivered < 500 → max 75
  // - Otherwise → no cap (100)
  let maxAllowedScore = 100;
  if (delivered < 100) {
    maxAllowedScore = 60;
  } else if (delivered < 500) {
    maxAllowedScore = 75;
  }

  const finalScore = Math.min(rawFinalScore, maxAllowedScore);

  let status;

  if (!hasEnoughVolume) {
    // Not enough sent/delivered to be sure
    if (finalScore >= 70) status = "learning_positive";
    else if (finalScore >= 40) status = "learning_neutral";
    else status = "learning_concerning";
  } else {
    if (finalScore >= 80) status = "healthy";
    else if (finalScore >= 60) status = "watch";
    else if (finalScore >= 40) status = "at_risk";
    else status = "critical";
  }

  let spamRisk;
  if (!hasEnoughVolume) {
    spamRisk = "unknown";
  } else if (complaintRate > 0.005 || bounceRate > 0.04) {
    spamRisk = "high";
  } else if (complaintRate > 0.001 || bounceRate > 0.02) {
    spamRisk = "medium";
  } else {
    spamRisk = "low";
  }

  return {
    tenantId,
    window,
    score: Math.round(finalScore),
    status,
    spamRisk,
    confidence: Math.round(confidence), // NEW

    metrics: {
      sent,
      delivered,
      bounces,
      complaints,
      rejects,
      opens,
      clicks,
      deliveryRate,
      bounceRate,
      complaintRate,
      openRate,
      clickRate,
      ctor,
      rejectRate,
    },
    subscores: {
      bounceComplaint: Math.round(scoreBC),
      engagement: Math.round(scoreEng),
      infrastructure: Math.round(scoreInfra),
      volume: Math.round(scoreVolume),
    },
  };
}

function getFromDate(window) {
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Compute spam complaint rate for a tenant over a given window.
 *
 * spamRate = complaints / delivered
 */
export async function computeTenantSpamRate(tenantId, window = "30d") {
  const from = getFromDate(window);

  // Group events by type for the tenant in the time window
  const grouped = await prisma.emailEvent.groupBy({
    by: ["eventType"],
    where: {
      tenantId,
      occurredAt: { gte: from },
    },
    _count: { _all: true },
  });

  let complaints = 0;
  let delivered = 0;

  for (const row of grouped) {
    const type = row.eventType.toUpperCase();
    if (type === "COMPLAINT") complaints = row._count._all;
    if (type === "DELIVERY") delivered = row._count._all;
  }

  // Avoid division by zero
  const spamRate = delivered > 0 ? complaints / delivered : 0;

  // Classify based on thresholds:
  // < 0.1% => healthy
  // 0.1%–0.3% => elevated
  // > 0.3% => high
  let level;
  if (delivered === 0) {
    level = "no_data";
  } else if (spamRate < 0.001) {
    level = "healthy"; // < 0.1%
  } else if (spamRate < 0.003) {
    level = "elevated"; // 0.1–0.3%
  } else {
    level = "high"; // > 0.3%
  }

  return {
    tenantId,
    window,
    delivered,
    complaints,
    spamRate, // e.g. 0.0007
    spamRatePercent: spamRate * 100, // e.g. 0.07
    level,
  };
}
