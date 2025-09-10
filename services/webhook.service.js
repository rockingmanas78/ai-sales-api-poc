import crypto from "crypto";
import { PrismaClient, SubscriptionStatus } from "@prisma/client";

const prisma = new PrismaClient();

function verifySignature(rawBody, signature, secret) {
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return hmac === signature;
}

// async function ensureUsagePeriodForCycle(args) {
//   // UsageCounter schema: tenantId, subscriptionId, metric, windowType, windowStart, windowEnd, qty
//   const { tenantId, cycleStart, cycleEnd, planEntitlements, subscriptionId } =
//     args;

//   // For each metric, check if a UsageCounter exists for this window
//   for (const metric of ["JOB", "CLASSIFICATION", "SEAT"]) {
//     const existing = await prisma.usageCounter.findFirst({
//       where: {
//         tenantId,
//         subscriptionId,
//         metric,
//         windowType: "PERIOD",
//         windowStart: cycleStart,
//         windowEnd: cycleEnd,
//       },
//     });
//     if (!existing) {
//       let initialQty = 0;
//       if (metric === "JOB") initialQty = planEntitlements.postCredits || 0;
//       if (metric === "CLASSIFICATION" || metric === "SEAT")
//         initialQty = planEntitlements.aiCredits || 0;
//       await prisma.usageCounter.create({
//         data: {
//           tenantId,
//           subscriptionId,
//           metric,
//           windowType: "PERIOD",
//           windowStart: cycleStart,
//           windowEnd: cycleEnd,
//           qty: initialQty,
//         },
//       });
//     }
//   }
// }

export async function handler(req, res) {
  try {
    console.log("Webhook initiated!");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.header("x-razorpay-signature") || "";
    const eventId = req.header("x-razorpay-event-id") || "";

    const rawBody = req.body;
    if (!eventId) return res.status(400).send("Missing event id");
    if (!signature) return res.status(400).send("Missing signature");

    // Debug: log type of req.body
    // console.log(
    //   "typeof req.body:",
    //   typeof rawBody,
    //   "isBuffer:",
    //   Buffer.isBuffer(rawBody)
    // );

    if (!verifySignature(rawBody, signature, secret)) {
      return res.status(400).send("Invalid signature");
    }

    // Only parse after signature is verified
    const event =
      Buffer.isBuffer(rawBody) || typeof rawBody === "string"
        ? JSON.parse(rawBody.toString())
        : rawBody;

    // console.log(secret, signature, eventId);
    // console.log("Event", event);

    const eventType = event.event;

    // 1) Idempotency: insert event first; if duplicate, exit
    try {
      await prisma.webhookEvent.create({
        data: {
          eventId,
          provider: "RAZORPAY",
          eventType,
        },
      });
    } catch (e) {
      if (e && e.code === "P2002") return res.sendStatus(200);
      throw e;
    }

    console.log("Event type", event);

    // 2) Dispatch
    switch (eventType) {
      case "subscription.activated": {
        const sub = event?.payload?.subscription?.entity;
        console.log("Activated event", event?.payload?.subscription);
        // console.log("Subscription", sub);
        if (!sub || !sub.id) break;

        const paymentTx = await prisma.paymentTransaction.findFirst({
          where: { providerId: sub.id },
        });
        if (!paymentTx) break;

        await prisma.subscription.update({
          where: { id: paymentTx.subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            providerCustId: sub.customer_id || undefined,
            nextBillingAt: sub.current_end
              ? new Date(sub.current_end * 1000)
              : undefined,
          },
        });

        break;
      }

      case "subscription.charged": {
        const subscriptionEntity = event?.payload?.subscription?.entity;
        const paymentEntity = event?.payload?.payment?.entity;
        console.log("Charges event", event?.payload?.subscription);
        if (!subscriptionEntity || !subscriptionEntity.id) break;

        // Find subscription
        const localSub = await prisma.subscription.findFirst({
          where: { providerSubId: subscriptionEntity.id },
        });
        // console.log("Local sub", localSub);
        if (!localSub) break;

        // Update PaymentTransaction for this subscription
        if (paymentEntity && paymentEntity.id) {
          await prisma.paymentTransaction.updateMany({
            where: {
              subscriptionId: localSub.id,
              providerId: subscriptionEntity.id,
            },
            data: {
              status: "COMPLETED",
              // Optionally, you can add invoiceId/invoiceUrl if available in paymentEntity
            },
          });
        }

        // Update subscription's nextBillingAt
        await prisma.subscription.update({
          where: { id: localSub.id },
          data: {
            nextBillingAt: subscriptionEntity.current_end
              ? new Date(subscriptionEntity.current_end * 1000)
              : undefined,
          },
        });

        // Optionally, update usage period if needed (uncomment if you use this logic)
        // if (subscriptionEntity.current_start && subscriptionEntity.current_end) {
        //   await ensureUsagePeriodForCycle({
        //     tenantId: localSub.tenantId,
        //     cycleStart: new Date(subscriptionEntity.current_start * 1000),
        //     cycleEnd: new Date(subscriptionEntity.current_end * 1000),
        //     planEntitlements: { postCredits: 0, aiCredits: 0 },
        //   });
        // }
        break;
      }

      case "invoice.paid": {
        const invoice = event?.payload?.invoice?.entity;
        const providerSubId = invoice && invoice.subscription_id;
        console.log("Paid event", event?.payload?.invoice);
        if (!providerSubId) break;

        const localSub = await prisma.paymentTransaction.update({
          where: { providerId: providerSubId },
          data: {
            status: "COMPLETED",
            invoiceId: invoice.id,
            invoiceUrl: invoice.short_url,
            paymentId: invoice.payment_id,
          },
        });
        if (!localSub) break;

        break;
      }

      case "subscription.pending":
      case "subscription.halted": {
        const sub = event?.payload?.subscription?.entity;
        console.log("Halted event", event?.payload?.subscription);
        if (!sub || !sub.id) break;
        await prisma.subscription.updateMany({
          where: { providerSubId: sub.id },
          data: { status: SubscriptionStatus.PAST_DUE },
        });
        break;
      }

      case "subscription.cancelled": {
        const sub = event?.payload?.subscription?.entity;
        console.log("[Webhook] subscription.cancelled event received", sub);
        if (!sub || !sub.id) {
          console.log(
            "[Webhook] No subscription entity or id found, skipping."
          );
          break;
        }
        // Cancel subscription(s)
        const cancelResult = await prisma.subscription.updateMany({
          where: { providerSubId: sub.id },
          data: { status: SubscriptionStatus.CANCELED },
        });
        // console.log("[Webhook] Cancelled subscriptions result:", cancelResult);
        // Also update tenant plan to FREE
        const localSub = await prisma.subscription.findFirst({
          where: { providerSubId: sub.id },
        });
        // console.log("[Webhook] Local subscription found:", localSub);
        if (localSub && localSub.tenantId) {
          try {
            const tenantUpdateResult = await prisma.tenant.update({
              where: { id: localSub.tenantId },
              data: { plan: "FREE" },
            });
            // console.log(
            //   "[Webhook] Tenant plan updated to FREE:",
            //   tenantUpdateResult
            // );
          } catch (e) {
            console.error("[Webhook] Failed to update tenant plan to FREE:", e);
          }

          // Find all subscriptions for this tenant and check planVersion.basePriceCents
          const freeSubs = await prisma.subscription.findMany({
            where: {
              tenantId: localSub.tenantId,
            },
            select: {
              id: true,
              planVersionId: true,
            },
          });
          // console.log("[Webhook] Free subscription candidates:", freeSubs);
          let activatedAny = false;
          for (const sub of freeSubs) {
            const planVersion = await prisma.planVersion.findUnique({
              where: { id: sub.planVersionId },
            });
            if (planVersion && planVersion.basePriceCents === 0) {
              try {
                const freeSubUpdate = await prisma.subscription.update({
                  where: { id: sub.id },
                  data: { status: SubscriptionStatus.ACTIVE },
                });
                // console.log(
                //   "[Webhook] Free subscription activated:",
                //   freeSubUpdate
                // );
                activatedAny = true;
              } catch (e) {
                console.error(
                  "[Webhook] Failed to activate free subscription:",
                  e
                );
              }
            }
          }
          if (!activatedAny) {
            console.log(
              "[Webhook] No eligible free subscription found or basePriceCents != 0."
            );
          }
        } else {
          console.log(
            "[Webhook] No localSub or tenantId found, skipping tenant plan update."
          );
        }
        break;
      }
    }

    // 3) Mark processed
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { processed: true, processedAt: new Date() },
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    res.sendStatus(500);
  }
}
