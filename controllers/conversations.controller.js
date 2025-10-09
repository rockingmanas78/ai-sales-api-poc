// controllers/conversation.controller.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// helpers
const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const stripHtml = (html = "") =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const makeSnippet = (msg) => {
  if (!msg) return null;
  const text = (msg.text && msg.text.trim()) || stripHtml(msg.html || "") || "";
  return text.length > 240 ? text.slice(0, 240) + "…" : text;
};

/**
 * GET /conversations?page=1&pageSize=20&query=search
 * Lists conversations for the current tenant, newest first.
 * query filters by subject or participant address.
 */
export async function listConversations(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "unauthorized" });

    const page = toInt(req.query.page, 1);
    const pageSize = Math.min(toInt(req.query.pageSize, 20), 100);
    const skip = (page - 1) * pageSize;
    const query = (req.query.query || "").trim();

    const where = {
      tenantId,
      ...(query
        ? {
          OR: [
            { subject: { contains: query, mode: "insensitive" } },
            { participants: { has: query } }, // exact email match in array
          ],
        }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          subject: true,
          participants: true,
          firstMessageAt: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
          EmailMessage: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              direction: true,
              subject: true,
              text: true,
              html: true,
              createdAt: true,
              from: true,
              to: true,
            },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    const data = items.map((c) => ({
      id: c.id,
      subject: c.subject,
      participants: c.participants,
      firstMessageAt: c.firstMessageAt,
      lastMessageAt: c.lastMessageAt,
      preview: makeSnippet(c.EmailMessage[0]),
      lastDirection: c.EmailMessage[0]?.direction || null,
    }));

    res.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /conversations/:conversationId/messages?sort=asc|desc&page=1&pageSize=50
 * Lists messages in a conversation for the current tenant.
 */
export async function getConversationMessages(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "unauthorized" });

    const { conversationId } = req.params;
    const sort =
      (req.query.sort || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    const page = toInt(req.query.page, 1);
    const pageSize = Math.min(toInt(req.query.pageSize, 50), 200);
    const skip = (page - 1) * pageSize;

    // ensure the conversation belongs to this tenant
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true },
    });
    if (!convo)
      return res.status(404).json({ error: "conversation not found" });

    const [items, total] = await prisma.$transaction([
      prisma.emailMessage.findMany({
        where: { tenantId, conversationId },
        orderBy: { createdAt: sort },
        skip,
        take: pageSize,
        select: {
          id: true,
          direction: true,
          provider: true,
          providerMessageId: true,
          subject: true,
          from: true,
          to: true,
          cc: true,
          bcc: true,
          text: true,
          html: true,
          headers: true,
          verdicts: true,
          inReplyTo: true,
          referencesIds: true,
          plusToken: true,
          s3Bucket: true,
          s3Key: true,
          receivedAt: true,
          sentAt: true,
          createdAt: true,
          campaignId: true,
          leadId: true,
        },
      }),
      prisma.emailMessage.count({ where: { tenantId, conversationId } }),
    ]);

    res.json({
      conversationId,
      sort,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: items,
    });
  } catch (err) {
    next(err);
  }
}


export async function getUniqueConversationsByCampaignID(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized: missing tenantId" });

    const { campaignId } = req.params;
    if (!campaignId || typeof campaignId !== "string") {
      return res.status(400).json({ error: "Invalid or missing campaignId" });
    }

    const sort = (req.query.sort || "asc").toLowerCase();
    if (!["asc", "desc"].includes(sort)) {
      return res.status(400).json({ error: "Invalid sort parameter, expected 'asc' or 'desc'" });
    }
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);

    if (page < 1 || pageSize < 1) {
      return res.status(400).json({ error: "Invalid page or pageSize, must be >= 1" });
    }
    const skip = (page - 1) * pageSize;

    // Step 1: Find unique conversation IDs for the campaign/tenant
    const uniqueConversations = await prisma.emailMessage.findMany({
      where: { tenantId, campaignId },
      distinct: ['conversationId'],
      select: { conversationId: true },
      orderBy: { createdAt: sort }
    });

    const total = uniqueConversations.length;
    const totalPages = Math.ceil(total / pageSize);
    const paginatedConversationIds = uniqueConversations
      .slice(skip, skip + pageSize)
      .map(convo => convo.conversationId);

    if (!paginatedConversationIds.length) {
      return res.json({ campaignId, conversations: [], total, totalPages, page, pageSize });
    }

    console.log(paginatedConversationIds)

    // Step 2: Get full Conversation objects for these IDs
    const conversations = await prisma.conversation.findMany({
      where: {
        id: { in: paginatedConversationIds },
        tenantId: tenantId
      },
      include: {
        EmailMessage: {
          where: { campaignId },
          select: {
            id: true,
            subject: true,
            createdAt: true,
            direction: true
          }
        }
      }
    });


    return res.json({
      campaignId,
      conversations,
      total,
      totalPages,
      page,
      pageSize
    });

  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}


