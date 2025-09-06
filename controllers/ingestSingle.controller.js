// controllers/ingestSingle.controller.js
import { Prisma, prisma, validateEventPayload, parseIsoDateOrNull } from '../utils/_shared.js';

const idemCache = new Map();

async function insertEvent(payload, dedupeKey) {
  const {
    event_name, occurred_at, user_id = null, anonymous_id = null, session_id = null,
    tenant_id = null, source = null, page_url = null, referrer = null,
    ip = null, user_agent = null, properties = {}, context = {},
    event_version = 1, schema_key = null,
  } = payload;

  const occurredAt = parseIsoDateOrNull(occurred_at);
  if (!occurredAt) {
    const err = new Error('occurred_at must be a valid ISO timestamp');
    err.code = 'VALIDATION';
    throw err;
  }
  
  return prisma.appEvent.create({
    data: {
      event_name,
      occurred_at: occurredAt,
      received_at: new Date(),
      user_id,
      anonymous_id,
      session_id,
      tenant_id,
      source,
      page_url,
      referrer,
      ip,
      user_agent,
      properties,
      context,
      event_version: typeof event_version === 'number' ? event_version : 1,
      schema_key,
      //dedupe_key: dedupeKey || null,
    },
    select: { event_id: true, received_at: true },
  });
}

export default async function ingestSingleEvent(req, res) {
  try {
    const ingestKey = req.get('X-Ingest-Key');
    if (!ingestKey) {
      return res.status(401).json({ status: 'error', code: 'unauthorized', message: 'X-Ingest-Key is required' });
    }

    const idempotencyKey = req.get('Idempotency-Key') || null;
    if (idempotencyKey && idemCache.has(idempotencyKey)) {
      const cached = idemCache.get(idempotencyKey);
      return res.status(cached.status).json(cached.body);
    }

    const errors = validateEventPayload(req.body);
    if (errors.length) {
      const body = { status: 'error', code: 'validation_error', message: errors };
      if (idempotencyKey) idemCache.set(idempotencyKey, { status: 400, body, t: Date.now() });
      return res.status(400).json(body);
    }

    const ip = req.ip || (req.headers['x-forwarded-for'] || '').toString().split(',') || req.socket?.remoteAddress || null;
    const user_agent = req.get('User-Agent') || null;

    const payload = {
      ...req.body,
      ip,
      user_agent,
      context: { ...(req.body.context || {}), network: { ip, user_agent } },
    };

    let deduped = false;
    let created;
    try {
      created = await insertEvent(payload, idempotencyKey);
    } catch (e) {
      if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
          (e.message && e.message.toLowerCase().includes('unique'))) {
        deduped = true;
        const existing = await prisma.app_event.findFirst({
          where: { dedupe_key: idempotencyKey },
          select: { event_id: true, received_at: true },
        });
        if (existing) {
          const body = { status: 'accepted', event_id: existing.event_id, received_at: existing.received_at.toISOString(), deduped: true };
          if (idempotencyKey) idemCache.set(idempotencyKey, { status: 202, body, t: Date.now() });
          return res.status(202).json(body);
        }
      } else if (e.code === 'VALIDATION') {
        const body = { status: 'error', code: 'validation_error', message: e.message };
        if (idempotencyKey) idemCache.set(idempotencyKey, { status: 400, body, t: Date.now() });
        return res.status(400).json(body);
      }
      throw e;
    }

    const body = { status: 'accepted', event_id: created.event_id, received_at: created.received_at.toISOString(), deduped };
    if (idempotencyKey) idemCache.set(idempotencyKey, { status: 202, body, t: Date.now() });
    return res.status(202).json(body);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
  }
}
