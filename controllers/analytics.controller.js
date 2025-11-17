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
import { prisma } from "./bulkEmail.controller.js";

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

    console.log(plans);

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

    res.status(200).json({ success: true, healthData });
  } catch (error) {
    console.error("Error in getHealthDeliverability:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
