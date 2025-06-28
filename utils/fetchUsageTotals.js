import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function fetchUsageTotals(tx, sub) {
  const usage = await tx.usageEvent.groupBy({
    by: ['metric'],
    where: {
      tenantId: sub.tenantId,
      recordedAt: {
        gte: sub.currentStart,
        lt: sub.currentEnd,
      }
    },
    _sum: { qty: true },
  });

  const result = {};
  for (const entry of usage) {
    result[entry.metric] = entry._sum.qty;
  }
  return result;
}