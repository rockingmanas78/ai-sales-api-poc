import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function latestPlanVersionId(planId, zone) {
  const version = await prisma.planVersion.findFirst({
    where: {
      planId,
      zone,
      bucket: 'PUBLIC',
      cadence: 'MONTHLY'
    },
    orderBy: {
      version: 'desc'
    }
  });

  return version?.id;
}
