import {
  runWarmupSchedulerTick,
} from "../services/warmup.scheduler.service.js";
import {
  runWarmupSenderTick,
} from "../services/warmup.sender.service.js";

function assertInternalSecret(request, expected) {
  const provided = request.headers["x-internal-secret"];
  return Boolean(expected && provided && String(provided) === String(expected));
}

export async function runWarmupSchedulerNow(req, res, next) {
  try {
    if (!assertInternalSecret(req, process.env.WARMUP_INBOUND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const result = await runWarmupSchedulerTick();
    return res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
}

export async function runWarmupSenderNow(req, res, next) {
  try {
    if (!assertInternalSecret(req, process.env.WARMUP_INBOUND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const result = await runWarmupSenderTick();
    return res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
}
