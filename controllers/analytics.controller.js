import {
  getTotalEmailsSent,
  getTotalEmailsOpened,
  getTotalEmailsReplied,
  getTotalActiveLeads,
  getMonthlyEmailPerformance,
  getLeadSourceData,
  getCampaignStats,
} from "../services/analytics.service.js";
import flatten from "../utils/flatten.js";
import {
  computeTenantSpamRate,
  computeTenantReputation,
} from "../services/reputation.service.js";
import { PrismaClient, MeterMetric } from "@prisma/client";

const prisma = new PrismaClient();

export const getAnalyticsOverview = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant ID is required" });
    }

    const [
      totalSent,
      totalOpened,
      totalReplied,
      totalActiveLeads,
      emailPerformanceData,
      leadSourceData,
      campaignStats,
    ] = await Promise.all([
      getTotalEmailsSent(tenantId),
      getTotalEmailsOpened(tenantId),
      // Updated: getTotalEmailsReplied should use lastDeliveryStatus: 'REPLIED'
      getTotalEmailsReplied(tenantId),
      getTotalActiveLeads(tenantId),
      getMonthlyEmailPerformance(tenantId),
      getLeadSourceData(tenantId),
      getCampaignStats(tenantId),
    ]);

    const averageOpenRate =
      totalSent === 0 ? 0 : ((totalOpened / totalSent) * 100).toFixed(2);
    const averageReplyRate =
      totalSent === 0 ? 0 : ((totalReplied / totalSent) * 100).toFixed(2);

    res.status(200).json({
      totalEmailSent: totalSent,
      averageOpenRate: `${averageOpenRate}%`,
      averageReplyRate: `${averageReplyRate}%`,
      averageActiveLeads: totalActiveLeads,
      emailPerformanceData,
      leadSourceData,
      campaignStats,
    });
  } catch (error) {
    console.error("Error in getAnalyticsOverview:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getViewUsage = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "Tenant ID is required" });
    }

    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    const tenantPlan = tenant.plan;

    const plans = await prisma.plan.findMany({
      where: { code: tenantPlan },
      include: {
        versions: {
          where: {
            // zone,
            // bucket: { in: [bucket, "PUBLIC"] },
            cadence: "MONTHLY",
          },
          orderBy: {
            version: "desc",
          },
          take: 1,
          include: {
            components: true,
          },
        },
      },
    });

    // console.log(plans);

    // Extract only required fields for each component
    let components = [];
    if (plans.length > 0 && plans[0].versions.length > 0) {
      components = plans[0].versions[0].components.map((c) => ({
        metric: c.metric,
        includedQty: c.includedQty,
        capPeriod: c.capPeriod,
        overageCents: c.overageCents,
      }));
    }

    res.status(200).json({
      success: true,
      components: components,
    });
  } catch (error) {
    console.error("Error in getViewUsage:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getHealthDeliverability = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "Tenant ID is required" });
    }

    const totalEmailsSent = await prisma.emailMessage.count({
      where: {
        tenantId,
      },
    });
    const totalDelivered = await prisma.emailMessage.count({
      where: {
        tenantId,
        lastDeliveryStatus: {
          in: ["DELIVERED", "OPENED", "CLICKED", "COMPLAINED"],
        },
      },
    });
    const totalOpened = await prisma.emailMessage.count({
      where: {
        tenantId,
        lastDeliveryStatus: "OPENED",
      },
    });

    const deliverabilityRate =
      totalDelivered === 0 ? 0 : (totalDelivered / totalEmailsSent) * 100;
    const openRate =
      totalDelivered === 0 ? 0 : (totalOpened / totalDelivered) * 100;
    const bounceRate =
      totalEmailsSent === 0
        ? 0
        : ((totalEmailsSent - totalDelivered) / totalEmailsSent) * 100;

    const healthData = { deliverabilityRate, openRate, bounceRate };

    // Compute spam/complaint rate and classification
    let spamInfo = null;
    try {
      spamInfo = await computeTenantSpamRate(tenantId);
    } catch (e) {
      console.error("Error computing spam rate:", e);
    }

    // Compute reputation summary (score, status, subscores)
    let reputationInfo = null;
    try {
      reputationInfo = await computeTenantReputation(tenantId);
    } catch (e) {
      console.error("Error computing reputation:", e);
    }

    res.status(200).json({
      success: true,
      healthData,
      spam: spamInfo,
      reputation: reputationInfo,
    });
  } catch (error) {
    console.error("Error in getHealthDeliverability:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getRemainingComponentsCount = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "Tenant ID is required" });
    }

    // Fetch tenant details
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Fetch the plan version for the tenant's plan
    const planVersion = await prisma.planVersion.findFirst({
      where: {
        Plan: {
          code: tenant.plan,
        },
        zone: tenant.zone,
      },
      orderBy: {
        version: "desc",
      },
      include: {
        components: true,
      },
    });

    if (!planVersion) {
      return res.status(404).json({ error: "Plan version not found" });
    }

    // Fetch the DailyCapCounter for the current date and tenant.
    // Stored records are normalized to midnight (00:00:00). Avoid exact equality
    // by matching the date range for the day: [startOfDay, nextDay).
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const nextDay = new Date(startOfDay);
    nextDay.setDate(startOfDay.getDate() + 1);

    const dailyCapCounters = await prisma.dailyCapCounter.findMany({
      where: {
        tenantId: tenantId,
        date: {
          gte: startOfDay,
          lt: nextDay,
        },
        metric: {
          in: planVersion.components.map((component) => component.metric),
        },
      },
    });

    // Map the daily usage to metrics for easy lookup
    const usageMap = dailyCapCounters.reduce((acc, counter) => {
      acc[counter.metric] = counter.qty;
      return acc;
    }, {});

    // Calculate remaining components
    const components = planVersion.components.map((component) => {
      const usedQty = usageMap[component.metric] || 0;
      return {
        metric: component.metric,
        includedQty: component.includedQty,
        capPeriod: component.capPeriod,
        overageCents: component.overageCents,
        remainingQty: component.includedQty - usedQty,
      };
    });

    res.status(200).json({
      success: true,
      components,
    });
  } catch (error) {
    console.error("Error in getRemainingComponentsCount:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
