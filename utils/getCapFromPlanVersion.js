// libs/usage/getCapFromPlanVersion.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Gets the cap value for a specific metric from the current plan version of the tenant.
 * @param {string} tenantId
 * @param {string} metric - e.g., 'JOB', 'CLASSIFICATION'
 * @param {string} capPeriod - 'DAY', 'MONTH', 'PERIOD'
 * @returns {Promise<number>} The included quantity (or -1 for unlimited)
 */
export async function getCapFromPlanVersion(tenantId, metric, capPeriod) {
  // First get the active subscription (assumes 1 active per tenant)
  const subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE'
    },
    include: {
      planVersion: {
        include: {
          components: true,
        },
      },
    },
  });

  if (!subscription || !subscription.planVersion) return 0; // Default to 0 if nothing found

  const component = subscription.planVersion.components.find(c =>
    c.metric === metric && c.capPeriod === capPeriod
  );

  return component ? component.includedQty : 0;
}
