// libs/usage/capGuard.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Checks if a tenant has exceeded their usage cap for a specific metric.
 * @param {string} metric - e.g., 'JOB'
 * @param {string} tenantId - the tenant ID
 * @param {number} qty - how many units of this metric to check (default: 1)
 * @param {number} capLimit - the allowed cap for the period
 * @returns {Promise<number>} - Returns -1 if cap exceeded, otherwise 1
 */
export async function capCheck(metric, tenantId, qty = 1, capLimit) {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const startOfDay = new Date(`${dateStr}T00:00:00Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59Z`);

  const usage = await prisma.usageEvent.aggregate({
    where: {
      tenantId,
      metric,
      recordedAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    _sum: {
      qty: true,
    },
  });

  const totalUsed = usage._sum.qty || 0;
  return totalUsed + qty > capLimit ? -1 : 1;
}
