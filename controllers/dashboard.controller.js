import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const getDashboardStats = async (req, res) => {
  const { tenantId } = req.user;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of the day

    const totalLeads = await prisma.lead.count({
      where: { tenantId, deletedAt: null },
    });

    const activeCampaigns = await prisma.emailCampaign.count({
      where: { tenantId, status: "ACTIVE" },
    });

    const emailsSentToday = await prisma.emailMessage.count({
      where: {
        tenantId,
        direction: "OUTBOUND",
        sentAt: { gte: today },
      },
    });

    const totalSent = await prisma.emailMessage.count({
      where: { tenantId, direction: "OUTBOUND", sentAt: { not: null } },
    });

    const totalReplied = await prisma.emailMessage.count({
      where: {
        tenantId,
        direction: "INBOUND",
        inReplyTo: { not: null }, // heuristics: reply if it references a previous message
      },
    });

    const responseRate =
      totalSent === 0
        ? 0
        : parseFloat(((totalReplied / totalSent) * 100).toFixed(1));

    res.json({
      totalLeads,
      activeCampaigns,
      emailsSentToday,
      responseRate,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard stats" });
  }
};
