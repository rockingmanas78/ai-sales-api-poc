import { PrismaClient } from '@prisma/client';
import { addMonths } from 'date-fns';
// import payments from '../../libs/payments/index.js'; // Uncomment when available

const prisma = new PrismaClient();

export const updateSubscription = async (req, res) => {
  const { tenantId, versionId } = req.body;

  if (!tenantId || !versionId) {
    return res.status(400).json({ message: 'tenantId and versionId are required' });
  }

  try {
    // 1. Get PlanVersion & related Plan
    const planVersion = await prisma.planVersion.findUnique({
      where: { id: versionId },
      include: {
        Plan: true,
        prices: true
      }
    });

    if (!planVersion) {
      return res.status(400).json({ message: 'Invalid plan version ID' });
    }

    // 2. Validate tenant
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null }
    });

    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const newStart = new Date();
    const newEnd = addMonths(newStart, 1);

    // 3. Update tenant's plan code
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { plan: planVersion.Plan.code }
    });

    // 4. Update or create subscription
    const existingSub = await prisma.subscription.findFirst({
      where: { tenantId, status: 'ACTIVE' }
    });

    let subscription;
    if (existingSub) {
      subscription = await prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          planVersionId: versionId,
          zone: planVersion.zone,
          currentStart: newStart,
          currentEnd: newEnd
        }
      });
    } else {
      subscription = await prisma.subscription.create({
        data: {
          tenantId,
          planVersionId: versionId,
          zone: planVersion.zone,
          status: 'ACTIVE',
          currentStart: newStart,
          currentEnd: newEnd
        }
      });
    }

    // 5. Optional payment integration
    let paymentInfo = null;
    // if (planVersion.prices.length > 0) {
    //   const gwResp = await payments.createGatewaySubscription(
    //     planVersion.prices[0].externalPriceId,
    //     tenant
    //   );
    //   paymentInfo = { clientSecret: gwResp.clientSecret };
    // }

    return res.status(200).json({
      message: 'Subscription updated successfully',
      subscription,
      paymentInfo
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
