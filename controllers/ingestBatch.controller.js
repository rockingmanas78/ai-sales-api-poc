// controllers/ingestBatch.controller.js
import { Prisma, prisma, sanitizeEventForInsert } from '../utils/_shared.js';

export default async function ingestBatchEvents(req, res) {
  try {
    const ingestKey = req.get('X-Ingest-Key');
    if (!ingestKey) {
      return res.status(401).json({ status: 'error', code: 'unauthorized', message: 'X-Ingest-Key is required' });
    }

    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : null;
    if (!events) {
      return res.status(400).json({ status: 'error', code: 'validation_error', message: 'events array is required' });
    }

    const ip = req.ip || (req.headers['x-forwarded-for'] || '').toString().split(',') || req.socket?.remoteAddress || null;
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
      if (typeof prisma.app_event.createManyAndReturn === 'function') {
        const created = await prisma.app_event.createManyAndReturn({
          data: toInsert.map(x => x.data),
          select: { event_id: true },
          skipDuplicates: true,
        });
        createdIds = created.map(r => r.event_id);
        accepted = created.length;
      } else {
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
    return res.status(500).json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
  }
}
