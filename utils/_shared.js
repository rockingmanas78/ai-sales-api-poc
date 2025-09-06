// controllers/_shared.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const { PrismaClient, Prisma } = require('@prisma/client');
export const prisma = new PrismaClient();

export function validateEventPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push('body must be a JSON object');
    return errors;
  }
  if (!body.event_name || typeof body.event_name !== 'string') {
    errors.push('event_name is required');
  }
  if (!body.occurred_at || typeof body.occurred_at !== 'string') {
    errors.push('occurred_at is required');
  }
  return errors;
}

export function parseIsoDateOrNull(s) {
  try {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function sanitizeEventForInsert(e, network) {
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
      context: { ...(e.context || {}), network: { ip, user_agent } },
      event_version: typeof e.event_version === 'number' ? e.event_version : 1,
      schema_key: e.schema_key ?? null,
      dedupe_key: e.dedupe_key ?? null,
    },
  };
}
