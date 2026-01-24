// controllers/warmup.webhooks.controller.js
import axios from "axios";
import SnsValidator from "sns-validator";
import { processWarmupInboundEvent } from "../services/warmup.inbound.service.js";
import { processWarmupSesSnsEvent } from "../services/warmup.sesEvents.service.js";

const snsValidator = new SnsValidator();

const WARMUP_TOPIC_ARNS = process.env.WARMUP_SNS_TOPIC_ARNS
  ? process.env.WARMUP_SNS_TOPIC_ARNS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

function assertInternalSecret(req, expected) {
  const provided = req.headers["x-internal-secret"];
  return Boolean(expected && provided && String(provided) === String(expected));
}

/**
 * IMPORTANT (Express):
 * For SNS signature validation, wire this route with express.raw({ type:  })
 * so req.body is a Buffer. If you can't, this controller still attempts to handle object bodies.
 */

/**
 * SES inbound pipeline forwarder (Lambda -> your API)
 * Internal secret is OK here because you control the caller.
 */
export async function warmupInboundWebhook(req, res) {
  try {
    if (!assertInternalSecret(req, process.env.WARMUP_INBOUND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // ACK immediately (Lambda shouldn't wait)
    res.status(202).end();

    // Process async
    setImmediate(async () => {
      try {
        await processWarmupInboundEvent(req.body);
      } catch (error) {
        console.error("warmupInboundWebhook processing failed:", error);
      }
    });
  } catch (error) {
    console.error("warmupInboundWebhook error:", error);
    try { res.status(202).end(); } catch {}
  }
}

/**
 * Warmup SNS events webhook
 * - validates SNS signature
 * - allowlists TopicArn
 * - handles SubscriptionConfirmation
 */
export async function warmupSesSnsEventsWebhook(req, res) {
  try {
    // Body can be Buffer (preferred) or object (fallback)
    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf-8")
        : (typeof req.body === "string" ? req.body : JSON.stringify(req.body || ""));

    if (!rawBody) return res.status(400).send("Empty body");

    let snsMessage;
    try {
      snsMessage = JSON.parse(rawBody);
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    const isSnsEnvelope = snsMessage && typeof snsMessage.Type === "string";
    if (!isSnsEnvelope) {
      return res.status(400).send("Expected SNS envelope");
    }

    // 1) Validate SNS signature
    await new Promise((resolve, reject) => {
      snsValidator.validate(snsMessage, (err) => (err ? reject(err) : resolve()));
    });

    // 2) Allowlist TopicArn (warmup only)
    if (WARMUP_TOPIC_ARNS.length && !WARMUP_TOPIC_ARNS.includes(snsMessage.TopicArn)) {
      return res.status(403).send("Unexpected TopicArn");
    }

    // 3) Subscription confirmation
    if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
      await axios.get(snsMessage.SubscribeURL);
      return res.status(200).send("Subscription confirmed");
    }

    if (snsMessage.Type !== "Notification") {
      return res.status(200).send("OK");
    }

    // 4) Process notification
    await processWarmupSesSnsEvent(snsMessage);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("warmupSesSnsEventsWebhook error:", error);
    return res.status(500).send("Internal server error");
  }
}



// // controllers/warmup.webhooks.controller.js
// import axios from "axios";
// import SnsValidator from "sns-validator";
// import { processWarmupInboundEvent } from "../services/warmup.inbound.service.js";
// import { processWarmupSesSnsEvent } from "../services/warmup.sesEvents.service.js";

// const snsValidator = new SnsValidator();

// const WARMUP_TOPIC_ARNS = process.env.WARMUP_SNS_TOPIC_ARNS
//   ? process.env.WARMUP_SNS_TOPIC_ARNS.split(",").map((s) => s.trim()).filter(Boolean)
//   : [];

// function assertInternalSecret(request, expected) {
//   const provided = request.headers["x-internal-secret"];
//   return Boolean(expected && provided && String(provided) === String(expected));
// }

// /**
//  * SES inbound pipeline forwarder -> internal secret is OK here (you control caller)
//  */
// export async function warmupInboundWebhook(req, res) {
//   try {
//     if (!assertInternalSecret(req, process.env.WARMUP_INBOUND_WEBHOOK_SECRET)) {
//       return res.status(401).json({ error: "unauthorized" });
//     }

//     res.status(202).end();

//     setImmediate(async () => {
//       try {
//         await processWarmupInboundEvent(req.body);
//       } catch (error) {
//         console.error("warmupInboundWebhook processing failed:", error);
//       }
//     });
//   } catch (error) {
//     console.error("warmupInboundWebhook error:", error);
//     try { res.status(202).end(); } catch {}
//   }
// }

// /**
//  * Warmup SNS -> validates SNS signature + TopicArn allowlist
//  */
// export async function warmupSesSnsEventsWebhook(req, res) {
//   try {
//     const rawBody =
//       Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : String(req.body || "");
//     if (!rawBody) return res.status(400).send("Empty body");

//     let snsMessage;
//     try {
//       snsMessage = JSON.parse(rawBody);
//     } catch {
//       return res.status(400).send("Invalid JSON");
//     }

//     const isSnsEnvelope = snsMessage && typeof snsMessage.Type === "string";
//     if (!isSnsEnvelope) {
//       // If you *ever* send direct SES event here, allow it explicitly:
//       // await processWarmupSesSnsEvent(snsMessage); return res.status(200).send("OK");
//       return res.status(400).send("Expected SNS envelope");
//     }

//     // 1) Validate SNS signature
//     await new Promise((resolve, reject) => {
//       snsValidator.validate(snsMessage, (err) => (err ? reject(err) : resolve()));
//     });

//     // 2) Allowlist TopicArn (warmup only)
//     if (WARMUP_TOPIC_ARNS.length && !WARMUP_TOPIC_ARNS.includes(snsMessage.TopicArn)) {
//       return res.status(403).send("Unexpected TopicArn");
//     }

//     // 3) Subscription confirmation
//     if (snsMessage.Type === "SubscriptionConfirmation" && snsMessage.SubscribeURL) {
//       await axios.get(snsMessage.SubscribeURL);
//       return res.status(200).send("Subscription confirmed");
//     }

//     if (snsMessage.Type !== "Notification") {
//       return res.status(200).send("OK");
//     }

//     // 4) Process (pass full envelope; your service already normalizes it)
//     await processWarmupSesSnsEvent(snsMessage);
//     return res.status(200).send("OK");
//   } catch (error) {
//     console.error("warmupSesSnsEventsWebhook error:", error);
//     return res.status(500).send("Internal server error");
//   }
// }
