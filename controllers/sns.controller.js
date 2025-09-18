// controllers/sns.controller.js
import axios from "axios";
import SnsValidator from "sns-validator";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const snsValidator = new SnsValidator();

const EXPECTED_TOPIC_ARNS = process.env.SNS_TOPIC_ARNS
  ? process.env.SNS_TOPIC_ARNS.split(",")
  : [];

/** Prefer event-specific timestamp, fallback to mail.timestamp, then now */
function extractOccurredAtTimestamp(sesEvent) {
  const eventType = String(sesEvent?.eventType || sesEvent?.notificationType || "").toLowerCase();
  const ts =
    (eventType === "send" && sesEvent?.send?.timestamp) ||
    (eventType === "delivery" && sesEvent?.delivery?.timestamp) ||
    (eventType === "bounce" && sesEvent?.bounce?.timestamp) ||
    (eventType === "complaint" && sesEvent?.complaint?.timestamp) ||
    (eventType === "open" && sesEvent?.open?.timestamp) ||
    (eventType === "click" && sesEvent?.click?.timestamp) ||
    (eventType === "reject" && sesEvent?.reject?.timestamp) ||
    (eventType === "renderingfailure" && sesEvent?.renderingFailure?.timestamp) ||
    (eventType === "deliverydelay" && sesEvent?.deliveryDelay?.timestamp) ||
    sesEvent?.mail?.timestamp ||
    new Date().toISOString();
  return new Date(ts);
}

/** Core processor used by both envelope and RAW handlers */
async function processSesEvent(sesEvent, snsMessageIdOrNull) {
  const rawEventType = sesEvent?.eventType || sesEvent?.notificationType || "Unknown";
  const eventType = String(rawEventType).toUpperCase();

  console.log("Processing SES event type:", eventType);
  console.log("SES Event payload:", JSON.stringify(sesEvent));

  const mail = sesEvent?.mail || {};
  const providerMessageId = mail?.messageId;
  if (!providerMessageId) return; // cannot correlate without SES messageId

  // Prefer tenantId from SES message tags (we tag on send)
  const taggedTenantId =
    (mail.tags?.tenantId && mail.tags.tenantId[0]) ||
    (mail.tags?.["tenantId"] && mail.tags["tenantId"][0]) ||
    null;

  // Find EmailMessage (try tenant-scoped first for speed/precision)
  let emailMessage = taggedTenantId
    ? await prisma.emailMessage.findFirst({
        where: { tenantId: taggedTenantId, providerMessageId },
        select: {
          id: true,
          tenantId: true,
          sentAt: true,
          firstOpenedAt: true,
          opensCount: true,
          clicksCount: true,
        },
      })
    : null;

  if (!emailMessage) {
    emailMessage = await prisma.emailMessage.findFirst({
      where: { providerMessageId },
      select: {
        id: true,
        tenantId: true,
        sentAt: true,
        firstOpenedAt: true,
        opensCount: true,
        clicksCount: true,
      },
    });
  }
  if (!emailMessage) return;

  // Normalize counters if legacy rows might have NULL (so increment won't keep NULL)
  if (emailMessage.opensCount == null || emailMessage.clicksCount == null) {
    await prisma.emailMessage.update({
      where: { id: emailMessage.id },
      data: {
        ...(emailMessage.opensCount == null ? { opensCount: 0 } : {}),
        ...(emailMessage.clicksCount == null ? { clicksCount: 0 } : {}),
      },
    });
    // refresh the local copy minimally
    emailMessage.opensCount = emailMessage.opensCount ?? 0;
    emailMessage.clicksCount = emailMessage.clicksCount ?? 0;
  }

  const occurredAt = extractOccurredAtTimestamp(sesEvent);

  // Record EmailEvent idempotently
  if (snsMessageIdOrNull) {
    await prisma.emailEvent.upsert({
      where: { snsMessageId: snsMessageIdOrNull },
      create: {
        tenantId: emailMessage.tenantId,
        emailMessageId: emailMessage.id,
        providerMessageId,
        eventType,
        occurredAt,
        snsMessageId: snsMessageIdOrNull,
        payload: sesEvent,
      },
      update: {},
    });
  } else {
    // RAW mode (no SNS MessageId): synthesize a stable-ish key by msgId+type+timestamp
    const syntheticSnsId = `raw:${providerMessageId}:${eventType}:${occurredAt.toISOString()}`;
    await prisma.emailEvent.upsert({
      where: { snsMessageId: syntheticSnsId },
      create: {
        tenantId: emailMessage.tenantId,
        emailMessageId: emailMessage.id,
        providerMessageId,
        eventType,
        occurredAt,
        snsMessageId: syntheticSnsId,
        payload: sesEvent,
      },
      update: {},
    });
  }

  // Update denormalized fields on EmailMessage (single UPDATE)
  const emailMessageUpdate = { lastEventAt: occurredAt };
  switch (eventType) {
    case "SEND":
      emailMessageUpdate.lastDeliveryStatus = "SENT";
      if (!emailMessage.sentAt) emailMessageUpdate.sentAt = occurredAt;
      break;
    case "DELIVERY":
      emailMessageUpdate.lastDeliveryStatus = "DELIVERED";
      break;
    case "OPEN":
      emailMessageUpdate.lastDeliveryStatus = "OPENED";
      if (!emailMessage.firstOpenedAt) emailMessageUpdate.firstOpenedAt = occurredAt;
      emailMessageUpdate.opensCount = { increment: 1 };
      break;
    case "CLICK":
      emailMessageUpdate.lastDeliveryStatus = "CLICKED";
      emailMessageUpdate.clicksCount = { increment: 1 };
      break;
    case "BOUNCE":
      emailMessageUpdate.lastDeliveryStatus = "BOUNCED";
      break;
    case "COMPLAINT":
      emailMessageUpdate.lastDeliveryStatus = "COMPLAINED";
      break;
    case "REJECT":
      emailMessageUpdate.lastDeliveryStatus = "REJECTED";
      break;
    case "RENDERING_FAILURE":
      emailMessageUpdate.lastDeliveryStatus = "RENDERING_FAILURE";
      break;
    case "DELIVERYDELAY":
      emailMessageUpdate.lastDeliveryStatus = "DELIVERY_DELAY";
      break;
    default:
      break;
  }

  await prisma.emailMessage.update({
    where: { id: emailMessage.id },
    data: emailMessageUpdate,
  });
}

export const handleSnsEvent = async (req, res) => {
  try {
    // With bodyParser.raw, req.body is a Buffer; accept Buffer or string
    const rawBody =
      Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : String(req.body || "");
    if (!rawBody) return res.status(400).send("Empty body");

    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    // Detect SNS envelope vs RAW SES event
    const isSnsEnvelope =
      parsedBody && (typeof parsedBody.Type === "string" || typeof parsedBody.Message === "string");

    if (isSnsEnvelope) {
      const snsMessage = parsedBody;

      // Verify signature (envelope only)
      await new Promise((resolve, reject) => {
        snsValidator.validate(snsMessage, (err) => (err ? reject(err) : resolve()));
      });

      // Allowlist TopicArn if configured
      if (EXPECTED_TOPIC_ARNS.length && !EXPECTED_TOPIC_ARNS.includes(snsMessage.TopicArn)) {
        return res.status(403).send("Unexpected TopicArn");
      }

      // Subscription flow
      if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
        await axios.get(snsMessage.SubscribeURL);
        return res.status(200).send("Subscription confirmed");
      }
      if (snsMessage.Type !== "Notification") {
        return res.status(200).send("OK");
      }

      // Process SES event inside the envelope
      const sesEvent = JSON.parse(snsMessage.Message);
      await processSesEvent(sesEvent, snsMessage.MessageId);
      return res.status(200).send("OK");
    }

    // RAW message delivery (SES event directly)
    await processSesEvent(parsedBody, null);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("SNS Handler Error:", error);
    return res.status(500).send("Internal server error");
  }
};


// // controllers/sns.controller.js
// import axios from "axios";
// import SnsValidator from "sns-validator";
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();
// const snsValidator = new SnsValidator();

// const EXPECTED_TOPIC_ARNS = process.env.SNS_TOPIC_ARNS
//   ? process.env.SNS_TOPIC_ARNS.split(",")
//   : [];

// // Pick event-specific timestamp where available
// function extractOccurredAt(ses) {
//   const et = (ses?.eventType || ses?.notificationType || "").toLowerCase();
//   const t =
//     (et === "send" && ses?.send?.timestamp) ||
//     (et === "delivery" && ses?.delivery?.timestamp) ||
//     (et === "bounce" && ses?.bounce?.timestamp) ||
//     (et === "complaint" && ses?.complaint?.timestamp) ||
//     (et === "open" && ses?.open?.timestamp) ||
//     (et === "click" && ses?.click?.timestamp) ||
//     (et === "reject" && ses?.reject?.timestamp) ||
//     (et === "renderingfailure" && ses?.renderingFailure?.timestamp) ||
//     (et === "deliverydelay" && ses?.deliveryDelay?.timestamp) ||
//     ses?.mail?.timestamp ||
//     new Date().toISOString();
//   return new Date(t);
// }

// export const handleSnsEvent = async (req, res) => {
//   try {
//     // Ensure the route uses express.text({ type: ["text/plain","application/json"] })
//     const rawBody = typeof req.body === "string" ? req.body : "";
//     if (!rawBody) {
//       console.warn("SNS: empty body");
//       return res.status(400).send("Empty body");
//     }

//     // Try parsing as JSON once
//     let parsed;
//     try {
//       parsed = JSON.parse(rawBody);
//     } catch (e) {
//       console.error("SNS: body not valid JSON", e);
//       return res.status(400).send("Invalid JSON");
//     }

//     console.log("Parsed SNS body:", parsed);

//     // Detect envelope vs RAW:
//     // - Standard SNS envelope has Type/Message/MessageId fields
//     const isSnsEnvelope =
//       parsed && (typeof parsed.Type === "string" || typeof parsed.Message === "string");

//     if (isSnsEnvelope) {
//       const snsMessage = parsed;

//       // (A) Verify signature
//       await new Promise((resolve, reject) => {
//         snsValidator.validate(snsMessage, (err) => (err ? reject(err) : resolve()));
//       });

//       // (B) Allowlist TopicArn
//       if (EXPECTED_TOPIC_ARNS.length && !EXPECTED_TOPIC_ARNS.includes(snsMessage.TopicArn)) {
//         return res.status(403).send("Unexpected TopicArn");
//       }

//       // (C) Subscription handshake
//       if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
//         await axios.get(snsMessage.SubscribeURL);
//         return res.status(200).send("Subscription confirmed");
//       }
//       if (snsMessage.Type !== "Notification") {
//         return res.status(200).send("OK");
//       }

//       // (D) Envelope contains SES event JSON string in Message
//       const sesEvent = JSON.parse(snsMessage.Message);
//       await processSesEvent(sesEvent, snsMessage.MessageId); // use real snsMessageId for idempotency

//       return res.status(200).send("OK");
//     }

//     // RAW message delivery (no SNS envelope): body is the SES event directly
//     const sesEvent = parsed;
//     await processSesEvent(sesEvent, null); // no snsMessageId in RAW mode
//     return res.status(200).send("OK");
//   } catch (error) {
//     console.error("❌ SNS Handler Error:", error);
//     return res.status(500).send("Internal server error");
//   }
// };

// async function processSesEvent(sesEvent, snsMessageIdOrNull) {
//   const rawType = sesEvent?.eventType || sesEvent?.notificationType || "Unknown";
//   const eventType = String(rawType).toUpperCase();

//   const mail = sesEvent?.mail || {};
//   const providerMessageId = mail?.messageId;
//   if (!providerMessageId) return; // nothing to correlate

//   // Prefer tenant from SES message tags
//   const tagTenant =
//     (mail.tags?.tenantId && mail.tags.tenantId[0]) ||
//     (mail.tags?.["tenantId"] && mail.tags["tenantId"][0]) ||
//     null;

//   // Find the EmailMessage to update (tenant-scoped first)
//   let emailMessage =
//     tagTenant
//       ? await prisma.emailMessage.findFirst({
//           where: { tenantId: tagTenant, providerMessageId },
//           select: {
//             id: true, tenantId: true, sentAt: true,
//             firstOpenedAt: true, opensCount: true, clicksCount: true,
//           },
//         })
//       : null;

//   if (!emailMessage) {
//     emailMessage = await prisma.emailMessage.findFirst({
//       where: { providerMessageId },
//       select: {
//         id: true, tenantId: true, sentAt: true,
//         firstOpenedAt: true, opensCount: true, clicksCount: true,
//       },
//     });
//   }
//   if (!emailMessage) return;

//   const occurredAt = extractOccurredAt(sesEvent);

//   // Write EmailEvent idempotently when we have snsMessageId (envelope mode)
//   if (snsMessageIdOrNull) {
//     await prisma.emailEvent.upsert({
//       where: { snsMessageId: snsMessageIdOrNull },
//       create: {
//         tenantId: emailMessage.tenantId,
//         emailMessageId: emailMessage.id,
//         providerMessageId,
//         eventType,
//         occurredAt,
//         snsMessageId: snsMessageIdOrNull,
//         payload: sesEvent,
//       },
//       update: {}, // no-op
//     });
//   } else {
//     // RAW mode: synthesize a stable-ish idempotency key.
//     // You can choose a different scheme; this one scopes by providerMessageId+eventType+occurredAt.
//     const syntheticId = `raw:${providerMessageId}:${eventType}:${new Date(occurredAt)
//       .toISOString()}`;
//     await prisma.emailEvent.upsert({
//       where: { snsMessageId: syntheticId },
//       create: {
//         tenantId: emailMessage.tenantId,
//         emailMessageId: emailMessage.id,
//         providerMessageId,
//         eventType,
//         occurredAt,
//         snsMessageId: syntheticId,
//         payload: sesEvent,
//       },
//       update: {}, // idempotent
//     });
//   }

//   // Update denormalized columns on EmailMessage
//   const update = { lastEventAt: occurredAt };
//   switch (eventType) {
//     case "SEND":
//       update.lastDeliveryStatus = "SENT";
//       if (!emailMessage.sentAt) update.sentAt = occurredAt;
//       break;
//     case "DELIVERY":
//       update.lastDeliveryStatus = "DELIVERED";
//       break;
//     case "OPEN":
//       update.lastDeliveryStatus = "OPENED";
//       if (!emailMessage.firstOpenedAt) update.firstOpenedAt = occurredAt;
//       update.opensCount = { increment: 1 };
//       break;
//     case "CLICK":
//       update.lastDeliveryStatus = "CLICKED";
//       update.clicksCount = { increment: 1 };
//       break;
//     case "BOUNCE":
//       update.lastDeliveryStatus = "BOUNCED";
//       break;
//     case "COMPLAINT":
//       update.lastDeliveryStatus = "COMPLAINED";
//       break;
//     case "REJECT":
//       update.lastDeliveryStatus = "REJECTED";
//       break;
//     case "RENDERING_FAILURE":
//       update.lastDeliveryStatus = "RENDERING_FAILURE";
//       break;
//     case "DELIVERYDELAY":
//       update.lastDeliveryStatus = "DELIVERY_DELAY";
//       break;
//     default:
//       break;
//   }

//   await prisma.emailMessage.update({
//     where: { id: emailMessage.id },
//     data: update,
//   });
// }