import prisma from "../utils/prisma.client.js";

/**
 * CREATE Warmup Message
 */
export async function createWarmupMessage(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    const {
      threadId,
      direction,
      subject,
      from,
      to,
      text,
      html,
      headers,
      warmupMarker,
      configurationSet,
    } = req.body;

    if (!tenantId || !threadId || !direction || !warmupMarker) {
      return res.status(400).json({
        error: "tenantId, threadId, direction and warmupMarker are required",
      });
    }

    const message = await prisma.warmupMessage.create({
      data: {
        tenantId,
        threadId,
        direction,
        subject: subject || null,
        from: from || [],
        to: to || [],
        text: text || null,
        html: html || null,
        headers: headers || {},
        warmupMarker,
        configurationSet: configurationSet || null,
      },
    });

    return res.status(201).json({
      message: "Warmup message created",
      data: message,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * LIST Warmup Messages (by tenant, optional filters)
 */
export async function listWarmupMessages(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { threadId, direction, limit = 50, offset = 0 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    const where = {
      tenantId,
      ...(threadId ? { threadId } : {}),
      ...(direction ? { direction } : {}),
    };

    const messages = await prisma.warmupMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: Number(offset),
      include: {
        WarmupThread: {
          select: { id: true, threadKey: true },
        },
        WarmupMessageEvent: true,
      },
    });

    return res.json({ messages });
  } catch (error) {
    next(error);
  }
}

/**
 * UPDATE Warmup Message
 */
export async function updateWarmupMessage(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const messageId = req.params.id;

    const {
      subject,
      text,
      html,
      headers,
      sentAt,
      receivedAt,
      providerMessageId,
    } = req.body;

    const existing = await prisma.warmupMessage.findFirst({
      where: { id: messageId, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Warmup message not found" });
    }

    const updated = await prisma.warmupMessage.update({
      where: { id: messageId },
      data: {
        ...(subject !== undefined ? { subject } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(html !== undefined ? { html } : {}),
        ...(headers !== undefined ? { headers } : {}),
        ...(sentAt ? { sentAt: new Date(sentAt) } : {}),
        ...(receivedAt ? { receivedAt: new Date(receivedAt) } : {}),
        ...(providerMessageId ? { providerMessageId } : {}),
      },
    });

    return res.json({
      message: "Warmup message updated",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE Warmup Message
 */
export async function deleteWarmupMessage(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const messageId = req.params.id;

    const existing = await prisma.warmupMessage.findFirst({
      where: { id: messageId, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Warmup message not found" });
    }

    await prisma.warmupMessage.delete({
      where: { id: messageId },
    });

    return res.json({ message: "Warmup message deleted" });
  } catch (error) {
    next(error);
  }
}
