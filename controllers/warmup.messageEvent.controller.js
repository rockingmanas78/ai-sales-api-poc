import { PrismaClient } from '@prisma/client';

/**
 * GET /warmup/message-events
 * List warmup message events for tenant
 *
 * Query params:
 *  - warmupMessageId (optional)
 *  - eventType (optional)
 *  - fromDate (optional)
 *  - toDate (optional)
 *  - limit (optional, default 20, max 100)
 *  - cursor (optional)
 */
const prisma = new PrismaClient();
export async function listWarmupMessageEvents(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const {
      warmupMessageId,
      eventType,
      fromDate,
      toDate,
      limit = 20,
      cursor,
    } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const where = {
      tenantId,
      ...(warmupMessageId
        ? { warmupMessageId: String(warmupMessageId) }
        : {}),
      ...(eventType ? { eventType: String(eventType).toUpperCase() } : {}),
      ...(fromDate || toDate
        ? {
            occurredAt: {
              ...(fromDate ? { gte: new Date(String(fromDate)) } : {}),
              ...(toDate ? { lte: new Date(String(toDate)) } : {}),
            },
          }
        : {}),
    };

    const events = await prisma.warmupMessageEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: Math.min(Number(limit), 100),
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: String(cursor) },
          }
        : {}),
      include: {
        WarmupMessage: {
          select: {
            id: true,
            subject: true,
            direction: true,
            from: true,
            to: true,
            warmupMarker: true,
          },
        },
      },
    });

    return res.json({
      events,
      nextCursor: events.length ? events[events.length - 1].id : null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /warmup/message-events/:id
 * Get single warmup message event
 */
export async function getWarmupMessageEventById(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const eventId = req.params.id;

    if (!tenantId || !eventId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const event = await prisma.warmupMessageEvent.findFirst({
      where: {
        id: eventId,
        tenantId,
      },
      include: {
        WarmupMessage: {
          select: {
            id: true,
            subject: true,
            direction: true,
            from: true,
            to: true,
            warmupMarker: true,
          },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ error: "Warmup message event not found" });
    }

    return res.json({ event });
  } catch (error) {
    next(error);
  }
}
