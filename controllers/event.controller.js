import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Prisma in ESM projects via createRequire to load CJS client safely
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

// Optional in-memory idempotency cache; replace with Redis/DB in production.
const idemCache = new Map();

async function insertEvent(payload, dedupeKey) {
  const {
    event_name,
    occurred_at,
    user_id = null,
    anonymous_id = null,
    session_id = null,
    tenant_id = null,
    source = null,
    page_url = null,
    referrer = null,
    ip = null,
    user_agent = null,
    properties = {},
    context = {},
    event_version = 1,
    schema_key = null,
  } = payload;

  const occurredAt = parseIsoDateOrNull(occurred_at);
  if (!occurredAt) {
    const err = new Error('occurred_at must be a valid ISO timestamp');
    err.code = 'VALIDATION';
    throw err;
  }

  const created = await prisma.app_event.create({
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
      dedupe_key: dedupeKey || null,
    },
    select: { event_id: true, received_at: true },
  });

  return created;
}

function sanitizeEventForInsert(e, network) {
  if (!e || typeof e !== 'object') return { ok: false, error: 'body must be a JSON object' };
  if (!e.event_name || typeof e.event_name !== 'string') return { ok: false, error: 'event_name is required' };
  if (!e.occurred_at || typeof e.occurred_at !== 'string') return { ok: false, error: 'occurred_at is required' };
  const occurredAt = parseIsoDateOrNull(e.occurred_at);
  if (!occurredAt) return { ok: false, error: 'occurred_at must be a valid ISO timestamp' };

  const ip = network.ip ?? null;
  const user_agent = network.user_agent ?? null;

  return {
    ok: true,
    data: {
      event_name: e.event_name,
      occurred_at: occurredAt,
      received_at: new Date(),
      user_id: e.user_id ?? null,
      anonymous_id: e.anonymous_id ?? null,
      session_id: e.session_id ?? null,
      tenant_id: e.tenant_id ?? null,
      source: e.source ?? null,
      page_url: e.page_url ?? null,
      referrer: e.referrer ?? null,
      ip,
      user_agent,
      properties: e.properties ?? {},
      context: {
        ...(e.context || {}),
        network: { ip, user_agent },
      },
      event_version: typeof e.event_version === 'number' ? e.event_version : 1,
      schema_key: e.schema_key ?? null,
      dedupe_key: e.dedupe_key ?? null,
    },
  };
}

// POST /e — Single event ingest
export const ingestSingleEvent = async (req, res) => {
  try {
    // Require X-Ingest-Key header
    const ingestKey = req.get('X-Ingest-Key');
    if (!ingestKey) {
      return res
        .status(401)
        .json({ status: 'error', code: 'unauthorized', message: 'X-Ingest-Key is required' });
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

    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] || '').toString().split(',') ||
      req.socket?.remoteAddress ||
      null;
    const user_agent = req.get('User-Agent') || null;

    const payload = {
      ...req.body,
      ip,
      user_agent,
      context: {
        ...(req.body.context || {}),
        network: { ip, user_agent },
      },
    };

    let deduped = false;
    let created;
    try {
      created = await insertEvent(payload, idempotencyKey);
    } catch (e) {
      // Unique violation (duplicate dedupe_key) => treat as deduped
      if (
        (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
        (e.message && e.message.toLowerCase().includes('unique'))
      ) {
        deduped = true;
        const existing = await prisma.app_event.findFirst({
          where: { dedupe_key: idempotencyKey },
          select: { event_id: true, received_at: true },
        });
        if (existing) {
          const body = {
            status: 'accepted',
            event_id: existing.event_id,
            received_at: existing.received_at.toISOString(),
            deduped: true,
          };
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

    const body = {
      status: 'accepted',
      event_id: created.event_id,
      received_at: created.received_at.toISOString(),
      deduped,
    };
    if (idempotencyKey) idemCache.set(idempotencyKey, { status: 202, body, t: Date.now() });
    return res.status(202).json(body);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
  }
};

// POST /e/batch — Batch ingest with partial acceptance
export const ingestBatchEvents = async (req, res) => {
  try {
    const ingestKey = req.get('X-Ingest-Key');
    if (!ingestKey) {
      return res
        .status(401)
        .json({ status: 'error', code: 'unauthorized', message: 'X-Ingest-Key is required' });
    }

    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : null;
    if (!events) {
      return res
        .status(400)
        .json({ status: 'error', code: 'validation_error', message: 'events array is required' });
    }

    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] || '').toString().split(',') ||
      req.socket?.remoteAddress ||
      null;
    const user_agent = req.get('User-Agent') || null;
    const network = { ip, user_agent };

    const toInsert = [];
    const errors = [];

    events.forEach((e, idx) => {
      const r = sanitizeEventForInsert(e, network);
      if (r.ok) toInsert.push({ data: r.data, idx });
      else errors.push({ index: idx, code: 'validation_error', message: r.error });
    });

    let createdIds = [];
    let accepted = 0;

    if (toInsert.length > 0) {
      // Prefer createManyAndReturn when available (Prisma >= 5.14, Postgres)
      if (typeof prisma.app_event.createManyAndReturn === 'function') {
        const created = await prisma.app_event.createManyAndReturn({
          data: toInsert.map(x => x.data),
          select: { event_id: true },
          skipDuplicates: true,
        });
        createdIds = created.map(r => r.event_id);
        accepted = created.length;
        // Note: rows skipped due to skipDuplicates don't throw; they also won't appear in createdIds
      } else {
        // Fallback: transactional individual inserts to collect IDs and granular errors
        const results = await prisma.$transaction(
          toInsert.map((x) =>
            prisma.app_event
              .create({ data: x.data, select: { event_id: true } })
              .then(r => ({ ok: true, id: r.event_id, idx: x.idx }))
              .catch(e => {
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                  return { ok: false, code: 'duplicate', idx: x.idx };
                }
                return { ok: false, code: 'db_error', message: e.message, idx: x.idx };
              })
          )
        );

        results.forEach(r => {
          if (r.ok) {
            createdIds.push(r.id);
            accepted += 1;
          } else if (r.code === 'duplicate') {
            errors.push({ index: r.idx, code: 'duplicate', message: 'duplicate dedupe_key' });
          } else {
            errors.push({ index: r.idx, code: 'db_error', message: r.message || 'db error' });
          }
        });
      }
    }

    const response = {
      status: 'accepted',
      accepted,
      rejected: errors.length,
      received_at: new Date().toISOString(),
      ids: createdIds,
      errors,
    };
    return res.status(202).json(response);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
  }
};

// GET /events — lightweight admin/query with filters + cursor pagination
export const listEvents = async (req, res) => {
  try {
    const {
      event_name,
      user_id,
      anonymous_id,
      tenant_id,
      since,
      until,
      limit,
      cursor,
    } = req.query;

    const where = {};
    if (event_name) where.event_name = String(event_name);
    if (user_id) where.user_id = String(user_id);
    if (anonymous_id) where.anonymous_id = String(anonymous_id);
    if (tenant_id) where.tenant_id = String(tenant_id);

    if (since || until) {
      where.occurred_at = {};
      if (since) {
        const d = parseIsoDateOrNull(String(since));
        if (d) where.occurred_at.gte = d;
      }
      if (until) {
        const d = parseIsoDateOrNull(String(until));
        if (d) where.occurred_at.lte = d;
      }
    }

    const take = Math.min(Math.max(parseInt(limit || '100', 10) || 100, 1), 500);

    let cursorObj = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(String(cursor), 'base64').toString('utf8');
        cursorObj = JSON.parse(decoded);
      } catch {
        // ignore malformed cursor
      }
    }

    const queryOptions = {
      where,
      orderBy: [{ occurred_at: 'desc' }, { event_id: 'desc' }],
      take,
      select: {
        event_id: true,
        event_name: true,
        occurred_at: true,
        user_id: true,
        anonymous_id: true,
        properties: true,
      },
    };

    if (cursorObj?.event_id) {
      queryOptions.cursor = { event_id: String(cursorObj.event_id) };
      queryOptions.skip = 1;
    }

    const rows = await prisma.app_event.findMany(queryOptions);

    let next_cursor = null;
    if (rows.length === take) {
      const last = rows[rows.length - 1];
      next_cursor = Buffer.from(JSON.stringify({ event_id: last.event_id })).toString('base64');
    }

    const data = rows.map(r => ({
      event_id: r.event_id,
      event_name: r.event_name,
      occurred_at: r.occurred_at.toISOString(),
      user_id: r.user_id,
      anonymous_id: r.anonymous_id,
      properties: r.properties,
    }));

    return res.json({ data, next_cursor });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
  }
};
