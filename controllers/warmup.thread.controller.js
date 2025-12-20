import { PrismaClient } from "@prisma/client";
/**
 * GET /warmup/threads
 * List warmup threads for tenant
 * Optional query:
 *  - profileId
 *  - limit
 *  - cursor (pagination)
 */
const prisma = new PrismaClient();
export async function listWarmupThreads(req, res, next) {
  try {
    // const tenantId = req.user?.tenantId;
    const {tenantId}=req.body;
    const { profileId, limit = 20, cursor } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const where = {
      tenantId,
      ...(profileId ? { profileId: String(profileId) } : {}),
    };

    const threads = await prisma.warmupThread.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit), 50),
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: String(cursor) },
          }
        : {}),
      include: {
        EmailWarmupProfile: {
          select: {
            id: true,
            emailIdentityId: true,
            mode: true,
            status: true,
          },
        },
        WarmupInbox: {
          select: {
            id: true,
            email: true,
            provider: true,
          },
        },
      },
    });

    return res.json({
      threads,
      nextCursor: threads.length ? threads[threads.length - 1].id : null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /warmup/threads/:id
 * Get a single warmup thread
 */
export async function getWarmupThreadById(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const threadId = req.params.id;

    if (!tenantId || !threadId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const thread = await prisma.warmupThread.findFirst({
      where: {
        id: threadId,
        tenantId,
      },
      include: {
        EmailWarmupProfile: {
          select: {
            id: true,
            emailIdentityId: true,
            mode: true,
            status: true,
          },
        },
        WarmupInbox: {
          select: {
            id: true,
            email: true,
            provider: true,
          },
        },
      },
    });

    if (!thread) {
      return res.status(404).json({ error: "Warmup thread not found" });
    }

    return res.json({ thread });
  } catch (error) {
    next(error);
  }
}
