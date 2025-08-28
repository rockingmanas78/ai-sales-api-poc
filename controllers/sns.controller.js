// controllers/sns.controller.js
import axios from "axios";
import MessageValidator from "sns-validator";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const validator = new MessageValidator();

const EXPECTED_TOPIC_ARNS = (process.env.SEND_EVENTS_TOPIC_ARNS || "").split(",").map(s => s.trim()).filter(Boolean);

export const handleSnsEvent = async (req, res) => {
  try {
    // Accept raw Buffer, stringified JSON, or parsed object
    const bodyStr = Buffer.isBuffer(req.body)
      ? req.body.toString("utf-8")
      : (typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    let snsMessage;
    try { snsMessage = JSON.parse(bodyStr); }
    catch { return res.status(400).send("Invalid JSON body"); }

    // 1) Verify SNS signature (AWS guidance)
    await new Promise((resolve, reject) => {
      validator.validate(snsMessage, (err) => err ? reject(err) : resolve());
    });

    // 2) Allowlist TopicArn
    if (EXPECTED_TOPIC_ARNS.length && !EXPECTED_TOPIC_ARNS.includes(snsMessage.TopicArn)) {
      return res.status(403).send("Unexpected TopicArn");
    }

    // 3) Handle SubscriptionConfirmation
    if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed");
    }

    if (snsMessage.Type !== "Notification") return res.status(200).send("OK");

    // 4) Process SES sending event
    const sesEvent = JSON.parse(snsMessage.Message);
    const eventType = sesEvent?.eventType;
    const msgId = sesEvent?.mail?.messageId;
    if (!msgId) return res.status(200).send("No messageId");

    const log = await prisma.emailLog.findFirst({
      where: { providerMessageId: msgId }
    });

    const now = new Date();
    switch (eventType) {
      case "Send":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", sentAt: log.sentAt ?? now } });
        break;
      case "Delivery":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT" } });
        break;
      case "Open":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "OPENED", openedAt: log.openedAt ?? now } });
        break;
      case "Click":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "CLICKED", clickedAt: log.clickedAt ?? now } });
        break;
      case "Bounce":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "BOUNCED" } });
        break;
      case "Complaint":
        if (log) await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED" } });
        break;
      default:
        // ignore others
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
