import { PrismaClient } from '@prisma/client';
import { addMonths } from 'date-fns';
import dotenv from 'dotenv';
import { initiatePhonePePayment, verifyPhonePeStatus } from '../services/payment.service.js';

dotenv.config();
const prisma = new PrismaClient();

// Update subscription + Create PhonePe order
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
    const newEnd = addMonths(newStart, 1);//--

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

    // 5. PhonePe payment integration
    let paymentInfo = null;

    if (planVersion.prices.length > 0) {
      const amount = planVersion.prices[0].price; // amount in paisa

      const { merchantTransactionId, redirectUrl } = await initiatePhonePePayment(
        tenantId,
        amount
      );

      // Save transaction
      await prisma.paymentTransaction.create({
        data: {
          tenantId,
          subscriptionId: subscription.id,
          phonepeOrderId: merchantTransactionId,
          amount,
          status: 'INITIATED'
        }
      });

      paymentInfo = {
        orderId: merchantTransactionId,
        redirectUrl
      };
    }

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

// Verify PhonePe transaction status
export const verifyPhonePePaymentStatus = async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ message: 'Order ID is required' });
  }

  try {
    const status = await verifyPhonePeStatus(orderId);

    // Update DB
    await prisma.paymentTransaction.updateMany({
      where: { phonepeOrderId: orderId },
      data: { status }
    });

    return res.status(200).json({
      message: 'Payment status fetched',
      orderId,
      status
    });

  } catch (error) {
    console.error('PhonePe verify error:', error?.response?.data || error.message);
    return res.status(500).json({ message: 'Error verifying PhonePe order' });
  }
};
