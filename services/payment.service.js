// services/payment.service.js
import { randomUUID, createHash } from "crypto";
import {
  StandardCheckoutClient,
  StandardCheckoutPayRequest,
  Env,
} from "pg-sdk-node";
import axios from "axios";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

dotenv.config();

// Configure PhonePe client
const clientId = process.env.PHONEPE_CLIENT_ID;
const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
const clientVersion = 1;
const env = Env.SANDBOX;

if (!clientId || !clientSecret || !process.env.FRONTEND_BASE_URL) {
  console.warn("⚠️ Missing PhonePe config values!");
}

const client = StandardCheckoutClient.getInstance(
  clientId,
  clientSecret,
  clientVersion,
  env
);

/**
 * Returns pricing info for a plan, zone, and cycle. Tax logic is commented for future scalability.
 */
export async function quotePlanWithTax(params) {
  // params: { plan: string, zone: string, cycle: string, tenantId?: string }
  const planRow = await prisma.plan.findFirst({
    where: { name: params.plan },
  });
  if (!planRow) throw new Error("Plan not found");
  const planId = planRow.id;

  let planVersion = await prisma.planVersion.findFirst({
    where: {
      planId,
      zone: params.zone,
    },
    orderBy: { version: "desc" },
  });

  if (!planVersion) {
    planVersion = await prisma.planVersion.findFirst({
      where: {
        planId,
        zone: params.zone,
        cadence: params.cycle,
        bucket: "PUBLIC",
      },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!planVersion)
    throw new Error("No PlanVersion found for given plan/zone/cycle");

  const base = Number(planVersion.basePriceCents) / 100;

  // const tax = await prisma.taxRate.findUnique({ where: { regionCode: params.zone } });
  // const taxRate = tax?.isActive ? Number(tax.ratePercentage) : 0;
  // const taxAmount = +(base * (taxRate / 100)).toFixed(2);
  // const total = +(base + taxAmount).toFixed(2);

  return {
    planVersionId: planVersion.id,
    planId: planVersion.planId,
    currency: planVersion.currency,
    base,
    // taxType: tax?.taxType ?? "NONE",
    // taxRatePct: taxRate,
    // taxAmount,
    // total,
  };
}

// Function to initiate PhonePe payment
export const initiatePhonePePayment = async (tenantId, amount) => {
  // Validate inputs
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("Invalid or missing tenantId");
  }

  if (typeof amount !== "number" || isNaN(amount) || amount <= 0) {
    throw new Error("Invalid amount for payment");
  }

  const merchantTransactionId = randomUUID();

  const frontendBase = process.env.FRONTEND_BASE_URL;
  if (!frontendBase) {
    throw new Error("Missing FRONTEND_BASE_URL in environment config");
  }

  const redirectUrl = `${frontendBase}/check-status?orderId=${merchantTransactionId}`;
  const callbackUrl = `${frontendBase}/api/verify-status/${merchantTransactionId}`;

  let request;
  try {
    request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantTransactionId)
      // .merchantUserId(tenantId)
      .amount(amount)
      .redirectUrl(redirectUrl)
      // .redirectMode('REDIRECT')
      // .callbackUrl(callbackUrl)
      // .paymentInstrument({ type: 'PAY_PAGE' })
      .build();
  } catch (err) {
    console.error("❌ Failed to build PhonePe payment request:", err);
    throw new Error("Could not build payment request");
  }

  let response;
  try {
    response = await client.pay(request);
  } catch (err) {
    console.error(
      "❌ PhonePe payment error:",
      err?.response?.data || err.message
    );
    throw new Error("Payment initiation failed");
  }

  console.log(response);

  if (!response?.redirectUrl || !merchantTransactionId) {
    throw new Error("Payment response missing required fields");
  }

  return {
    merchantTransactionId,
    redirectUrl: response.redirectUrl,
  };
};

// Function to verify PhonePe order status
export const verifyPhonePeStatus = async (orderId) => {
  if (!orderId || typeof orderId !== "string") {
    throw new Error("Order ID is required and must be a string");
  }

  try {
    // const merchantId = process.env.MERCHANT_ID || 'PGTESTPAYUAT';
    // const saltKey = process.env.SALT_KEY;
    // const saltIndex = process.env.SALT_INDEX;

    // const path = `/pg/v1/status/${merchantId}/${orderId}`;
    // const baseUrl = 'https://api-preprod.phonepe.com';

    // const stringToHash = path + saltKey;
    // const sha256 = createHash('sha256').update(stringToHash).digest('hex');
    // const xVerify = `${sha256}###${saltIndex}`;

    // const response = await axios.get(`${baseUrl}${path}`, {
    //   headers: {
    //     'X-VERIFY': xVerify,
    //     'Content-Type': 'application/json'
    //   }
    // });

    const response = await client.getOrderStatus(orderId);

    if (!response || typeof response !== "object") {
      throw new Error("Invalid response from PhonePe order status check");
    }

    console.log(response);

    return response;
  } catch (error) {
    console.error(
      "❌ Error in verifying PhonePe order status:",
      error?.response?.data || error.message
    );
    throw new Error("Failed to verify order status");
  }
};
