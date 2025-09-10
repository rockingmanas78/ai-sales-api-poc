// modules/billing/razorpay.adaptor.js
import Razorpay from "razorpay";

export const razorpayClient = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * @param {Object} createArgs
 * @param {string} createArgs.plan_id
 * @param {0|1|boolean} [createArgs.customer_notify]
 * @param {number} [createArgs.total_count]
 * @param {number} [createArgs.start_at]
 * @param {Object} [createArgs.notes]
 */
export async function createRazorpaySubscription(createArgs) {
  // Normalize booleans and timestamps
  const payload = {
    ...createArgs,
    customer_notify:
      typeof createArgs.customer_notify === "boolean"
        ? createArgs.customer_notify
          ? 1
          : 0
        : createArgs.customer_notify != null
        ? createArgs.customer_notify
        : 1,
  };

  // If someone passed ms by mistake, coerce to seconds
  if (payload.start_at && payload.start_at > 1e12) {
    payload.start_at = Math.floor(payload.start_at / 1000);
  }

  try {
    console.log("[Razorpay] create subscription payload:", payload);
    const created = await razorpayClient.subscriptions.create(payload);
    console.log("[Razorpay] created subscription:", {
      id: created.id, // use the actual subscription id returned by Razorpay
      status: created.status,
      current_start: created.current_start,
      current_end: created.current_end,
    });
    return created;
  } catch (error) {
    // Razorpay errors are usually nested under error.error
    const details = error && error.error ? error.error : error;
    console.error("[Razorpay] create subscription failed:", details);
    throw details;
  }
}

export function cancelRazorpaySubscription(providerSubscriptionId, options) {
  // Extract cancel_at_cycle_end and pass as second argument
  const cancelAtCycleEnd = options && options.cancel_at_cycle_end;
  return razorpayClient.subscriptions.cancel(
    providerSubscriptionId,
    cancelAtCycleEnd
  );
}

export function fetchRazorpaySubscription(providerSubscriptionId) {
  return razorpayClient.subscriptions.fetch(providerSubscriptionId);
}
