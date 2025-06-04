import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// GET all email logs for a tenant
export const getEmailLogs = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    const logs = await prisma.emailLog.findMany({
      where: { tenantId },
      include: {
        campaign: true,
        lead: true,
      },
      orderBy: { sentAt: 'desc' },
    });

    res.json(logs);
  } catch (error) {
    console.error('Error fetching email logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET single email log by ID and tenant
export const getEmailLogById = async (req, res) => {
  try {
    const { logId } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required in request body' });
    }

    const log = await prisma.emailLog.findFirst({
      where: {
        id: logId,
        tenantId,
      },
      include: {
        campaign: true,
        lead: true,
      },
    });

    if (!log) {
      return res.status(404).json({ error: 'Email log not found or does not belong to tenant' });
    }

    res.json(log);
  } catch (error) {
    console.error('Error fetching email log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
