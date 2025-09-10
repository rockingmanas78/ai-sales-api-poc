import axios from "axios";
import SnsValidator from "sns-validator";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const snsValidator = new SnsValidator();

// allowlist expected topics
const EXPECTED_TOPIC_ARNS = process.env.SNS_TOPIC_ARNS
  ? process.env.SNS_TOPIC_ARNS.split(",")
  : [];

export const handleSnsEvent = async (req, res) => {
  try {
    // 1) Normalize body
    const bodyStr = Buffer.isBuffer(req.body)
      ? req.body.toString("utf-8")
      : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body);

    let snsMessage;
    try {
      snsMessage = JSON.parse(bodyStr);
    } catch {
      return res.status(400).send("Invalid JSON body");
    }

    // 2) Verify SNS signature
    await new Promise((resolve, reject) => {
      snsValidator.validate(snsMessage, (err) =>
        err ? reject(err) : resolve()
      );
    });

    // 3) Allowlist TopicArn
    if (
      EXPECTED_TOPIC_ARNS.length &&
      !EXPECTED_TOPIC_ARNS.includes(snsMessage.TopicArn)
    ) {
      return res.status(403).send("Unexpected TopicArn");
    }

    // 4) Handle subscription confirmation
    if (
      snsMessage.Type === "SubscriptionConfirmation" &&
      snsMessage.SubscribeURL
    ) {
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed");
    }

    if (snsMessage.Type !== "Notification") {
      return res.status(200).send("OK");
    }

    // 5) Parse SES notification
    const sesEvent = JSON.parse(snsMessage.Message);
    const eventType = sesEvent?.eventType;
    const msgId = sesEvent?.mail?.messageId;
    if (!msgId) return res.status(200).send("No messageId");

    // Find related emailMessage
    const emailMessage = await prisma.emailMessage.findFirst({
      where: { providerMessageId: msgId },
      select: { id: true, tenantId: true },
    });
    if (!emailMessage) {
      console.warn(`⚠️ No emailMessage found for SES msgId=${msgId}`);
      return res.status(200).send("No matching emailMessage");
    }

    const now = new Date();

    // 6) Record event in emailEvent table
    await prisma.emailEvent.create({
      data: {
        tenantId: emailMessage.tenantId,
        messageId: emailMessage.id,
        type: eventType.toUpperCase(), // e.g. "DELIVERY", "OPEN", "CLICK"
        providerMessageId: msgId,
        createdAt: now,
        metadata: sesEvent,
      },
    });

    // 7) Optionally update denormalized columns in emailMessage
    switch (eventType) {
      case "Send":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { sentAt: now },
        });
        break;
      case "Delivery":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { deliveredAt: now },
        });
        break;
      case "Open":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { openedAt: { set: now } },
        });
        break;
      case "Click":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { clickedAt: { set: now } },
        });
        break;
      case "Bounce":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { bouncedAt: now },
        });
        break;
      case "Complaint":
        await prisma.emailMessage.update({
          where: { id: emailMessage.id },
          data: { failedAt: now },
        });
        break;
      default:
        // ignore unknowns
        break;
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("❌ SNS Handler Error:", error);
    return res.status(500).send("Internal server error");
  }
};

// import axios from 'axios';

// export const handleSnsEvent = async (req, res) => {
//   try {
//     let snsMessage;

//     // Support raw body from AWS SNS
//     if (Buffer.isBuffer(req.body)) {
//       const rawBody = req.body.toString("utf-8");
//       snsMessage = JSON.parse(rawBody);
//     } else {
//       return res.status(400).send("Unsupported body format.");
//     }

//     console.log("📨 SNS Message Type:", snsMessage.Type);

//     // 1. Handle subscription confirmation
//     if (snsMessage.Type === "SubscriptionConfirmation") {
//       console.log("🔔 SubscriptionConfirmation received");
//       console.log("🔗 Confirming subscription:", snsMessage.SubscribeURL);

//       // Automatically confirm the subscription
//       await axios.get(snsMessage.SubscribeURL);
//       return res.status(200).send("Subscription confirmed");
//     }

//     // 2. Handle notification
//     if (snsMessage.Type === "Notification") {
//       const sesEvent = JSON.parse(snsMessage.Message); // actual SES payload
//       console.log("📩 SES Event Received:", sesEvent.eventType);

//       switch (sesEvent.eventType) {
//         case "Send":
//           // update sent status
//           break;
//         case "Open":
//           // update open tracking
//           break;
//         case "Click":
//           // update click tracking
//           break;
//         case "Bounce":
//           // update bounce status
//           break;
//         default:
//           console.log("⚠️ Unhandled eventType:", sesEvent.eventType);
//       }

//       return res.status(200).send("Notification processed");
//     }

//     return res.status(200).send("Unhandled message type");
//   } catch (error) {
//     console.error("❌ SNS Handler Error:", error);
//     return res.status(500).send("Internal server error");
//   }
// };
