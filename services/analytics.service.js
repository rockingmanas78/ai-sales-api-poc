import prisma from "../utils/prisma.client.js";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";

// Total emails SENT
export const getTotalEmailsSent = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, sentAt: { not: null } },
  });
};

// Total emails OPENED
export const getTotalEmailsOpened = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, openedAt: { not: null } },
  });
};

// Total emails REPLIED
export const getTotalEmailsReplied = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, repliedAt: { not: null } },
  });
};

// Total emails CLICKED
export const getTotalEmailsClicked = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, clickedAt: { not: null } },
  });
};

// Total emails BOUNCED
export const getTotalEmailsBounced = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, bouncedAt: { not: null } },
  });
};

// Total emails FAILED (e.g. complaints)
export const getTotalEmailsFailed = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, failedAt: { not: null } },
  });
};

// Total emails still QUEUED (created but not sent)
export const getTotalEmailsQueued = async (tenantId) => {
  return prisma.emailMessage.count({
    where: { tenantId, sentAt: null },
  });
};

// Total active leads
export const getTotalActiveLeads = async (tenantId) => {
  return prisma.lead.count({
    where: {
      tenantId,
      status: { not: "NOT_INTERESTED" },
    },
  });
};

/**
 * ---- MONTHLY PERFORMANCE ----
 * Returns stats for last 6 months: sent, opened, replied
 */
export const getMonthlyEmailPerformance = async (tenantId) => {
  const currentDate = new Date();
  const monthsData = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonth(subMonths(currentDate, i));
    const monthEnd = endOfMonth(subMonths(currentDate, i));

    const monthName = monthStart.toLocaleString("default", { month: "short" });

    const [sent, opened, replied] = await Promise.all([
      prisma.emailMessage.count({
        where: { tenantId, sentAt: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.emailMessage.count({
        where: { tenantId, openedAt: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.emailMessage.count({
        where: { tenantId, repliedAt: { gte: monthStart, lte: monthEnd } },
      }),
    ]);

    monthsData.push({ month: monthName, sent, opened, replied });
  }

  return monthsData;
};

export const getLeadSourceData = async (tenantId) => {
  const sources = await prisma.lead.groupBy({
    by: ["source"],
    where: { tenantId },
    _count: { source: true },
  });

  const colorMap = {
    AI_GENERATED: "#3B82F6",
    CSV_UPLOAD: "#10B981",
    MANUAL_ENTRY: "#F59E0B",
    API_IMPORT: "#EF4444",
  };

  return sources.map(({ source, _count }) => ({
    name: source
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase()),
    value: _count.source,
    color: colorMap[source] || "#6B7280", // default gray
  }));
};

export const getCampaignStats = async (tenantId) => {
  const campaigns = await prisma.emailCampaign.findMany({
    where: { tenantId },
    select: {
      id: true,
      status: true,
      EmailMessage: {
        select: {
          status: true,
        },
      },
      template: {
        select: {
          name: true, // Fetch the name from related EmailTemplate
        },
      },
    },
  });

  return campaigns.map((campaign) => {
    const counts = {
      sent: 0,
      opened: 0,
      replied: 0,
    };

    for (const msg of campaign.EmailMessage) {
      if (msg.status === "SENT") counts.sent += 1;
      if (msg.status === "OPENED") counts.opened += 1;
      if (msg.status === "REPLIED") counts.replied += 1;
    }

    return {
      id: campaign.id,
      name: campaign.template?.name || "Untitled Campaign",
      status: campaign.status.toLowerCase(),
      ...counts,
    };
  });
};
