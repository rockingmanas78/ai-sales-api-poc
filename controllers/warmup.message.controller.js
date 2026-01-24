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
    const { 
      threadId, 
      direction, 
      emailIdentityId, // <-- NEW FILTER for specific profile activity
      limit = 50, 
      offset = 0 
    } = req.query;

    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

    // Build Where Clause
    const where = {
      tenantId,
      ...(threadId ? { threadId } : {}),
      ...(direction ? { direction } : {}),
    };

    // If filtering by specific Identity (Profile), we need to find the related threads
    if (emailIdentityId) {
       // Find the profile first
       const profile = await prisma.emailWarmupProfile.findUnique({
         where: { emailIdentityId },
         select: { id: true }
       });
       
       if (profile) {
         where.WarmupThread = {
           profileId: profile.id
         };
       }
    }

    const messages = await prisma.warmupMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number(limit),
      skip: Number(offset),
      include: {
        WarmupThread: {
          select: { 
            id: true, 
            threadKey: true,
            // Include Inbox to get Provider Info for UI
            WarmupInbox: {
              select: {
                id: true,
                email: true,
                provider: true // <--- UI needs this (Google/Outlook)
              }
            }
          },
        },
        WarmupMessageEvent: {
           select: { eventType: true, occurredAt: true } // For status bubbles
        }, 
      },
    });

    // Helper to format for UI if needed, or send raw
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
