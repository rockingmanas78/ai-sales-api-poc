import {
  getTotalEmailsSent,
  getTotalEmailsOpened,
  getTotalEmailsReplied,
  getTotalActiveLeads,
  getMonthlyEmailPerformance,
  getLeadSourceData,
  getCampaignStats,
} from '../services/analytics.service.js';

export const getAnalyticsOverview = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID is required' });
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
      getTotalEmailsReplied(tenantId),
      getTotalActiveLeads(tenantId),
      getMonthlyEmailPerformance(tenantId),
      getLeadSourceData(tenantId),
      getCampaignStats(tenantId),
    ]);

    const averageOpenRate = totalSent === 0 ? 0 : ((totalOpened / totalSent) * 100).toFixed(2);
    const averageReplyRate = totalSent === 0 ? 0 : ((totalReplied / totalSent) * 100).toFixed(2);

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
    console.error('Error in getAnalyticsOverview:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
