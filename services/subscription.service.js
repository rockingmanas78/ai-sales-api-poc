import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import { quotePlanWithTax } from "./payment.service.js";
import {
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  fetchRazorpaySubscription,
} from "./razorpay.adaptor.js";

// Start payment for a subscription
export async function startPaymentService(params) {
  try {
    // console.log("[startPaymentService] params:", params);
    // params: { tenantId, planTier, billingCycle }
    const tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
    });
    // console.log("[startPaymentService] tenant:", tenant);
    if (!tenant) throw new Error("Tenant not found");

    // Get quote (includes planVersion, price, currency)
    const quote = await quotePlanWithTax({
      plan: params.planTier,
      zone: tenant.zone,
      cycle: params.billingCycle,
      tenantId: tenant.id,
    });
    // console.log("[startPaymentService] quote:", quote);

    // Use plan_id from planPrice table based on zone and planId
    const planVersion = await prisma.planVersion.findUnique({
      where: { id: quote.planVersionId },
    });
    // console.log("[startPaymentService] planVersion:", planVersion);
    // Fetch planPrice row for zone + planId
    const planPrice = await prisma.plan.findFirst({
      where: {
        code: tenant.zone,
        id: planVersion.planId,
      },
    });
    // console.log("[startPaymentService] planPrice:", planPrice);
    const razorpayPlanId =
      planPrice?.plan_id || planVersion.providerPlanId || planVersion.id;
    const amount = planVersion.basePriceCents;
    const notes = {
      tenantId: tenant.id,
      planTier: params.planTier,
      billingCycle: params.billingCycle,
    };
    // console.log("[startPaymentService] notes:", notes);

    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      // Mark all other tenant subscriptions as PAUSED
      const updateResult = await tx.subscription.updateMany({
        where: { tenantId: tenant.id, status: "ACTIVE" },
        data: { status: "PAUSED" },
      });
      // console.log("[startPaymentService] updateMany result:", updateResult);

      // Find all PAUSED subscriptions for this tenant with providerSubId
      const pausedSubs = await tx.subscription.findMany({
        where: {
          tenantId: tenant.id,
          status: "PAUSED",
          providerSubId: { not: null },
        },
      });
      // console.log(
      //   "[startPaymentService] PAUSED subscriptions to cancel:",
      //   pausedSubs
      // );
      for (const sub of pausedSubs) {
        try {
          const cancelResult = await cancelRazorpaySubscription(
            sub.providerSubId,
            { cancel_at_cycle_end: false }
          );
          // console.log(
          //   `[startPaymentService] Cancelled Razorpay subscription for subId ${sub.id}:`,
          //   cancelResult
          // );
        } catch (err) {
          console.error(
            `[startPaymentService] Failed to cancel Razorpay subscription for subId ${sub.id}:`,
            err
          );
        }
      }

      await tx.tenant.update({
        where: { id: tenant.id },
        data: { plan: params.planTier.toUpperCase() },
      });

      // Create a new subscription with status PENDING
      const newSubscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planVersionId: planVersion.id,
          zone: tenant.zone,
          status: "PENDING",
          currentStart: new Date(),
          currentEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)),
          provider: tenant.zone === "IN" ? "RAZORPAY" : undefined,
        },
      });
      // console.log("[startPaymentService] newSubscription:", newSubscription);

      const razorpayPlanId = await tx.priceId.findFirst({
        where: {
          planVersionId: planVersion.id,
        },
      });
      // console.log("[startPaymentService] razorpayPlanId:", razorpayPlanId);

      // Razorpay subscription creation is external, so do it outside transaction
      let razorpaySub;
      try {
        razorpaySub = await createRazorpaySubscription({
          plan_id: razorpayPlanId.gatewayPlanId,
          customer_notify: 1,
          total_count: 12,
          notes,
        });
        // console.log("[startPaymentService] razorpaySub:", razorpaySub);
      } catch (err) {
        console.error(
          "[startPaymentService] Razorpay subscription error:",
          err
        );
        throw new Error(
          "Failed to initiate Razorpay subscription: " + err.message
        );
      }

      // Save providerOrderId in PaymentTransaction, link to new subscription
      const providerOrderId = razorpaySub.id;
      const paymentTx = await tx.paymentTransaction.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: newSubscription.id,
          providerId: providerOrderId,
          amount,
          status: "INITIATED",
        },
      });
      await tx.subscription.update({
        where: { id: newSubscription.id },
        data: { providerSubId: razorpaySub.id },
      });
      // console.log("[startPaymentService] paymentTx:", paymentTx);

      return {
        success: true,
        planVersionId: planVersion.id,
        amount: amount / 100,
        currency: planVersion.currency,
        providerOrderId,
        razorpaySub,
        paymentTransactionId: paymentTx.id,
        subscriptionId: newSubscription.id,
        quote,
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        subscription_id: razorpaySub.id,
      };
    });
    return result;
  } catch (err) {
    console.error("[startPaymentService] error:", err);
    throw err;
  }
}

export async function updateSubscriptionService(params) {
  // params: { tenantId, planTier, billingCycle }
  // Find tenant and zone
  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
  });
  if (!tenant) throw new Error("Tenant not found");
  // Find planId from Plan table
  const planRow = await prisma.plan.findFirst({
    where: { code: params.planTier },
  });
  if (!planRow) throw new Error("Plan not found");
  const planId = planRow.id;
  // Find latest PlanVersion for plan/zone/cadence
  const planVersion = await prisma.planVersion.findFirst({
    where: {
      planId,
      zone: tenant.zone,
      cadence: params.billingCycle,
      bucket: "PUBLIC",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!planVersion) throw new Error("No PlanVersion found");
  // Only update DB, no external provider call
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: tenant.id, status: "ACTIVE" },
  });
  if (!subscription) throw new Error("No active subscription found");
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      planVersionId: planVersion.id,
      zone: tenant.zone,
      status: "ACTIVE",
      currentStart: new Date(),
      currentEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)),
    },
  });
  return {
    success: true,
    subscriptionId: subscription.id,
    planVersionId: planVersion.id,
  };
}

// Cancel subscription
export async function cancelSubscriptionService(params) {
  // console.log("[cancelSubscriptionService] params:", params);
  // params: { tenantId }
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: params.tenantId, status: "ACTIVE" },
  });
  if (!subscription) throw new Error("No active subscription found");
  // console.log("[cancelSubscriptionService] subscription:", subscription);

  // Call Razorpay API to cancel subscription if providerSubId exists
  if (subscription.providerSubId) {
    let razorpayCancelResult;
    try {
      razorpayCancelResult = await cancelRazorpaySubscription(
        subscription.providerSubId,
        { cancel_at_cycle_end: false }
      );
      // console.log("Razorpay cancel result:", razorpayCancelResult);
    } catch (err) {
      console.error("Failed to cancel Razorpay subscription:", err);
      try {
        console.error(
          "Full error (stringified):",
          JSON.stringify(err, null, 2)
        );
      } catch (e) {
        console.error("Error stringification failed:", e);
      }
      // Optionally, you can throw or continue
    }
  }

  // await prisma.subscription.update({
  //   where: { id: subscription.id },
  //   data: { status: "CANCELED" },
  // });
  return { success: true, subscriptionId: subscription.id };
}

// Get subscription name
export async function getSubscriptionNameService({ tenantId }) {
  try {
    // Find active subscription for tenant
    // console.log("getSubscriptionNameService tenantId:", tenantId);
    const sub = await prisma.subscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
    });
    // console.log("getSubscriptionNameService sub:", sub);
    if (!sub) {
      return { success: false, data: null };
    }

    // Fetch planVersion
    const planVersion = await prisma.planVersion.findUnique({
      where: { id: sub.planVersionId },
    });
    if (!planVersion) {
      return { success: false, data: null };
    }

    // console.log("getSubscriptionNameService planVersion:", planVersion);
    // Fetch plan
    const plan = await prisma.plan.findUnique({
      where: { id: planVersion.planId },
    });
    if (!plan) {
      return { success: false, data: null };
    }

    // Get plan code
    const planCode = plan.code;

    return {
      success: true,
      data: {
        planCode,
        planVersionId: sub.planVersionId,
        subscriptionId: sub.id,
      },
    };
  } catch (err) {
    console.error("getSubscriptionNameService error:", err);
    return { success: false, data: null };
  }
}

// Get subscription charges
export async function getSubscriptionChargesService(tenantId) {
  // Find all COMPLETED payment transactions for the tenant
  const charges = await prisma.paymentTransaction.findMany({
    where: {
      tenantId,
      status: "COMPLETED",
    },
    orderBy: { createdAt: "desc" },
  });
  // console.log("getSubscriptionChargesService charges:", charges);
  const mappedCharges = charges.map((c) => ({
    id: c.id,
    providerOrderId: c.providerId,
    amount: c.amount,
    status: c.status,
    createdAt: c.createdAt,
    paymentUrl: c.invoiceUrl,
  }));
  // console.log("getSubscriptionChargesService mappedCharges:", mappedCharges);
  return mappedCharges;
}

// Get payment status
export async function getPaymentStatusService(paymentId) {
  const payment = await prisma.paymentTransaction.findUnique({
    where: { id: paymentId },
  });
  if (!payment) throw new Error("Payment not found");
  return {
    success: true,
    status: payment.status,
    providerOrderId: payment.providerId,
    amount: payment.amount / 100,
  };
}
