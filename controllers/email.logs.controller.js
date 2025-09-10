import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/**
 * GET all email messages for a tenant
 * (replaces "email logs")
 */
export const getEmailMessages = async (req, res) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "tenantId is required in URL params." });
    }

    const messages = await prisma.emailMessage.findMany({
      where: { tenantId },
      include: {
        campaign: true,
        lead: true,
        conversation: true,
        events: {
          orderBy: { createdAt: "desc" },
          take: 5, // fetch latest few events per message
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(messages);
  } catch (error) {
    console.error("Error fetching email messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET single email message by ID (scoped to tenant)
 */
export const getEmailMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    const tenantId = req.query.tenantId;

    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "tenantId is required in query params." });
    }

    const message = await prisma.emailMessage.findFirst({
      where: {
        id: messageId,
        tenantId,
      },
      include: {
        campaign: true,
        lead: true,
        conversation: true,
        events: {
          orderBy: { createdAt: "asc" }, // full event timeline
        },
      },
    });

    if (!message) {
      return res.status(404).json({
        error: "Email message not found or does not belong to tenant",
      });
    }

    res.json(message);
  } catch (error) {
    console.error("Error fetching email message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
