// controllers/listEvents.controller.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function parseIsoDateOrNull(s) {
  try {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export async function listEvents(req, res) {
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

    const take = Math.min(
      Math.max(parseInt(limit || "100", 10) || 100, 1),
      500
    );

    let cursorObj = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(String(cursor), "base64").toString("utf8");
        cursorObj = JSON.parse(decoded);
      } catch {
        // ignore malformed cursor
      }
    }

    const queryOptions = {
      where,
      orderBy: [{ occurred_at: "desc" }, { event_id: "desc" }],
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

    const rows = await prisma.appEvent.findMany(queryOptions);

    let next_cursor = null;
    if (rows.length === take) {
      const last = rows[rows.length - 1];
      next_cursor = Buffer.from(
        JSON.stringify({ event_id: last.event_id })
      ).toString("base64");
    }

    const data = rows.map((r) => ({
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
    return res.status(500).json({
      status: "error",
      code: "internal_error",
      message: "unexpected error",
    });
  }
}

export async function tenantEventList(req, res) {
  try {
    const { tenantId } = req.query;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required in query" });
    }

    // Use service to fetch events
    const { getTenantScheduledEvents } = await import(
      "../services/tenantEventsList.service.js"
    );
    const events = await getTenantScheduledEvents(tenantId);
    res.json(events);
  } catch (error) {
    console.error("Error fetching tenant events:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getSessionsByUserId(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "userId is required in params" });
    }

    const sessions = await prisma.appEvent.findMany({
      where: { user_id: userId },
      orderBy: { occurred_at: 'desc' }, // sort latest to oldest
      select: {
        occurred_at: true,
        session_id: true,
        tenant_id: true,
      },
    });

    res.status(200).json({ sessions });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}