import { PlanType, PrismaClient } from '@prisma/client';
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

    if (!planVersion?.Plan) {
      return res.status(400).json({ message: 'Plan relation missing in PlanVersion' });
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

    let paymentInfo = null;
    let merchantTransactionId = null;
    let redirectUrl = null;
    let amount = 0;
    const requiresPayment = planVersion.basePriceCents > 0;

    // 3. Initiate PhonePe payment if required (moved up to happen before DB updates)
    if (requiresPayment) {
      if (typeof planVersion.basePriceCents !== 'number' || planVersion.basePriceCents < 0) {
        return res.status(500).json({ message: 'Plan base price is invalid' });
      }

      amount = planVersion.basePriceCents; // amount in paisa

      let paymentResponse;
      try {
        paymentResponse = await initiatePhonePePayment(tenantId, amount);
      } catch (err) {
        console.error('Failed to initiate PhonePe transaction:', err);
        return res.status(502).json({ message: 'Failed to initiate payment process' });
      }

      const { merchantTransactionId: phonePeMerchantTransactionId, redirectUrl: phonePeRedirectUrl } = paymentResponse || {};

      if (!phonePeMerchantTransactionId || !phonePeRedirectUrl) {
        return res.status(500).json({ message: 'PhonePe did not return valid transaction data' });
      }

      merchantTransactionId = phonePeMerchantTransactionId;
      redirectUrl = phonePeRedirectUrl;

      console.log("TransactionId:", merchantTransactionId);
      console.log("redirectUrl:", redirectUrl);
    }

    // 4. Update tenant's plan code
    // const planCode = planVersion?.Plan?.code; // e.g., "STARTER"

    // 3. Initiate PhonePe payment if required (moved up to happen before DB updates)
    if (requiresPayment) {
      if (typeof planVersion.basePriceCents !== 'number' || planVersion.basePriceCents < 0) {
        return res.status(500).json({ message: 'Plan base price is invalid' });
      }

      amount = planVersion.basePriceCents; // amount in paisa

      let paymentResponse;
      try {
        paymentResponse = await initiatePhonePePayment(tenantId, amount);
      } catch (err) {
        console.error('Failed to initiate PhonePe transaction:', err);
        return res.status(502).json({ message: 'Failed to initiate payment process' });
      }

      const { merchantTransactionId: phonePeMerchantTransactionId, redirectUrl: phonePeRedirectUrl } = paymentResponse || {};

      if (!phonePeMerchantTransactionId || !phonePeRedirectUrl) {
        return res.status(500).json({ message: 'PhonePe did not return valid transaction data' });
      }

      merchantTransactionId = phonePeMerchantTransactionId;
      redirectUrl = phonePeRedirectUrl;

      console.log("TransactionId:", merchantTransactionId);
      console.log("redirectUrl:", redirectUrl);
    }

    // 4. Update tenant's plan code
    // const planCode = planVersion?.Plan?.code; // e.g., "STARTER"

    // console.log(PlanType);

    // // Make sure planCode is a valid value
    // if (!planCode || typeof planCode !== 'string' || !Object.values(PlanType).includes(planCode)) {
    //   console.log(`Invalid Plan Code ${planCode} `);
    //   return res.status(500).json({ message: 'Invalid Plan Code' });
    // }

    // try {
    //   await prisma.tenant.update({
    //     where: { id: tenantId },
    //     data: {
    //       plan: planCode, // ✅ Use enum mapping
    //     },
    //   });
    // } catch (err) {
    //   console.error('Error updating tenant plan:', err);
    //   return res.status(500).json({ message: 'Failed to update tenant plan' });
    // }

    // 5. Update or create subscription
    const existingSub = await prisma.subscription.findFirst({
      where: { tenantId, status: 'ACTIVE' } // Find active subscription if any
    });

    let subscription;
    try {
      const subscriptionStatus = requiresPayment ? 'PENDING' : 'ACTIVE'; // Set status based on payment requirement

      if (existingSub) {
        subscription = await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            planVersionId: versionId,
            zone: planVersion.zone,
            currentStart: newStart,
            currentEnd: newEnd,
            status: subscriptionStatus // Update status
          }
        });
      } else {
        subscription = await prisma.subscription.create({
          data: {
            tenantId,
            planVersionId: versionId,
            zone: planVersion.zone,
            status: subscriptionStatus, // Set initial status
            currentStart: newStart,
            currentEnd: newEnd
          }
        });
      }
    } catch (err) {
      console.error('Error saving subscription:', err);
      return res.status(500).json({ message: 'Failed to create/update subscription' });
    }

    // 6. Save payment transaction
    if (requiresPayment && merchantTransactionId) {
      try {
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
      } catch (err) {
        console.error('Error saving payment transaction:', err);
        // This is a critical error. Payment initiated, but transaction not recorded.
        // Consider more robust error handling or rollback here if possible.
        return res.status(500).json({ message: 'Failed to record payment transaction' });
      }
    }

    return res.status(200).json({
      message: requiresPayment ? 'Subscription update initiated. Awaiting payment confirmation.' : 'Subscription updated successfully.',
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

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ message: 'Order ID is required and must be a string' });
  }

  try {
    const status = await verifyPhonePeStatus(orderId);

    if (!status || typeof status !== 'object') {
      return res.status(502).json({ message: 'Invalid response from PhonePe' });
    }

    const state = status.state;

    // Update DB
    // Prisma doesn't support updateManyAndReturn by default.
    // We'll use updateMany + findMany for side-effects as needed.

    await prisma.paymentTransaction.updateMany({
      where: { phonepeOrderId: orderId },
      data: { status: state }
    });
    // Now get the payment transaction(s) again for response usage:
    const paymentDetails = await prisma.paymentTransaction.findMany({
      where: { phonepeOrderId: orderId },
      include: { Tenant: true, Subscription: true }
    });

    console.log("Payment Details : ", paymentDetails);

    const subscriptionId = paymentDetails[0]?.Subscription?.id;
    // Defensive: if Subscription does not exist, respond accordingly
    if (!subscriptionId) {
      return res.status(400).json({ message: 'Subscription not found for this payment transaction' });
    }

    // 5. Update or create subscription
    const existingSub = await prisma.subscription.findFirst({
      where: { id: subscriptionId } // Find subscription by id
    });

    let subscription;
    try {
      const subscriptionStatus = state === 'COMPLETED' ? 'ACTIVE' : 'PENDING'; // Set status based on payment requirement

      if (existingSub) {
        subscription = await prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            status: subscriptionStatus // Update status
          }
        });
      }
    } catch (err) {
      console.error('Error saving subscription:', err);
      return res.status(500).json({ message: 'Failed to create/update subscription' });
    }

    console.log("This is subscription: ", subscription);

    if (subscription && subscription.status === 'ACTIVE') {
      // 4. Update tenant's plan code

      console.log(paymentDetails[0]?.Tenant?.id);
      const currentSub = await prisma.subscription.findFirst({
        where: { tenantId: paymentDetails[0]?.Tenant?.id, status: 'ACTIVE' } // Find active subscription if any
      });
      console.log(currentSub);

      if(currentSub) {
        const planVersion = await prisma.planVersion.findUnique({
          where: { id: currentSub.planVersionId },
          include: {
            Plan: true,
            prices: true
          }
        });
        const planCode = planVersion?.Plan?.code; // e.g., "STARTER"

        console.log(PlanType);

        // Make sure planCode is a valid value
        if (!planCode || typeof planCode !== 'string' || !Object.values(PlanType).includes(planCode)) {
          console.log(`Invalid Plan Code ${planCode} `);
          return res.status(500).json({ message: 'Invalid Plan Code' });
        }

        try {
          await prisma.tenant.update({
            where: { id: currentSub.tenantId },
            data: {
              plan: planCode, // ✅ Use enum mapping
            },
          });
        } catch (err) {
          console.error('Error updating tenant plan:', err);
          return res.status(500).json({ message: 'Failed to update tenant plan' });
        }
      }
    }

    // Note: Without a paymentTransaction table or a direct link (like phonepeOrderId)
    // on the subscription model, it's not possible to automatically update the
    // subscription status or tenant plan based solely on the PhonePe orderId
    // in this function. This function will only verify the payment status.

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
