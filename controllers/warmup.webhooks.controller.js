import {
  processWarmupInboundEvent,
} from "../services/warmup.inbound.service.js";
import {
  processWarmupSesSnsEvent,
} from "../services/warmup.sesEvents.service.js";

function assertInternalSecret(request, expected) {
  const provided = request.headers["x-internal-secret"];
  return Boolean(expected && provided && String(provided) === String(expected));
}

/**
 * This webhook is called ONLY by SES Receiving pipelines you configure for:
 *  - SaleFunnel warmup inbox domains (MX -> SES inbound)
 *  - SaleFunnel reply domain (WARMUP_REPLY_DOMAIN)
 *
 * IMPORTANT: Do NOT reuse your existing inboundWebhook route for this.
 */
export async function warmupInboundWebhook(req, res) {
  try {
    if (!assertInternalSecret(req, process.env.WARMUP_INBOUND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Ack fast
    res.status(202).end();

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
 * This webhook is subscribed to SNS event destination of your SES WARMUP configuration set
 * (SEND/DELIVERY/OPEN/CLICK/BOUNCE/COMPLAINT etc). 
 */
export async function warmupSesSnsEventsWebhook(req, res) {
  try {
    if (!assertInternalSecret(req, process.env.WARMUP_EVENTS_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    res.status(202).end();

    setImmediate(async () => {
      try {
        await processWarmupSesSnsEvent(req.body);
      } catch (error) {
        console.error("warmupSesSnsEventsWebhook failed:", error);
      }
    });
  } catch (error) {
    console.error("warmupSesSnsEventsWebhook error:", error);
    try { res.status(202).end(); } catch {}
  }
}
