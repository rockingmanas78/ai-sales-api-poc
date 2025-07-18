// services/payment.service.js
import { randomUUID, createHash } from 'crypto';
import { StandardCheckoutClient, StandardCheckoutPayRequest, Env } from 'pg-sdk-node';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Configure PhonePe client
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const clientVersion = 1;
const env = Env.SANDBOX;

const client = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);

// Function to initiate PhonePe payment
export const initiatePhonePePayment = async (tenantId, amount) => {
  const merchantTransactionId = randomUUID();

  const redirectUrl = `${process.env.FRONTEND_BASE_URL}/check-status?orderId=${merchantTransactionId}`;
  const callbackUrl = `${process.env.FRONTEND_BASE_URL}/api/verify-status/${merchantTransactionId}`;

  const request = StandardCheckoutPayRequest.builder()
    .merchantTransactionId(merchantTransactionId)
    .merchantUserId(tenantId)
    .amount(amount)
    .redirectUrl(redirectUrl)
    .redirectMode('REDIRECT')
    .callbackUrl(callbackUrl)
    .paymentInstrument({ type: 'PAY_PAGE' })
    .build();

  const response = await client.pay(request);

  return {
    merchantTransactionId,
    redirectUrl: response.data.instrumentResponse.redirectInfo.url
  };
};

// Function to verify PhonePe order status
export const verifyPhonePeStatus = async (orderId) => {
  const merchantId = process.env.MERCHANT_ID || 'PGTESTPAYUAT';
  const saltKey = process.env.SALT_KEY;
  const saltIndex = process.env.SALT_INDEX;

  const path = `/pg/v1/status/${merchantId}/${orderId}`;
  const baseUrl = 'https://api-preprod.phonepe.com';

  const stringToHash = path + saltKey;
  const sha256 = createHash('sha256').update(stringToHash).digest('hex');
  const xVerify = `${sha256}###${saltIndex}`;

  const response = await axios.get(`${baseUrl}${path}`, {
    headers: {
      'X-VERIFY': xVerify,
      'Content-Type': 'application/json'
    }
  });

  return response?.data?.data?.state || 'UNKNOWN';
};
