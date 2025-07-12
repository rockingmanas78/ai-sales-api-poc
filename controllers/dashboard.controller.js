import { PrismaClient } from '@prisma/client';
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
      where: { tenantId, status: 'ACTIVE' },
    });

    const emailsSentToday = await prisma.emailLog.count({
      where: {
        tenantId,
        sentAt: { gte: today },
        status: 'SENT',
      },
    });

    const totalSent = await prisma.emailLog.count({
      where: { tenantId, status: 'SENT' },
    });

    const totalReplied = await prisma.emailLog.count({
      where: { tenantId, status: 'REPLIED' },
    });

    const responseRate = totalSent === 0 ? 0 : ((totalReplied / totalSent) * 100).toFixed(1);

    res.json({
      totalLeads,
      activeCampaigns,
      emailsSentToday,
      responseRate: parseFloat(responseRate),
    });

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ message: "Failed to fetch dashboard stats" });
  }
};
