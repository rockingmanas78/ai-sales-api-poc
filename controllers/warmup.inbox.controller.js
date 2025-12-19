import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * List active warmup inboxes
 */
export async function listWarmupInboxes(req, res) {
  try {
    const inboxes = await prisma.warmupInbox.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        provider: true,
        domain: true,
        status: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: inboxes,
    });
  } catch (error) {
    console.error("[listWarmupInboxes] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch warmup inboxes",
    });
  }
}

/**
 * Create warmup inbox
 * ⚠️ Should be ADMIN / SYSTEM only
 */
export async function createWarmupInbox(req, res) {
  try {
    const { tenantId, email, provider, domain } = req.body;

    if (!tenantId || !email || !provider) {
      return res.status(400).json({
        success: false,
        error: "tenantId, email and provider are required",
      });
    }

    const inbox = await prisma.warmupInbox.create({
      data: {
        tenantId,
        email,
        provider,
        domain: domain || email.split("@")[1],
        status: "ACTIVE",
      },
    });

    return res.status(201).json({
      success: true,
      data: inbox,
    });
  } catch (error) {
    console.error("[createWarmupInbox] error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to create warmup inbox",
    });
  }
}

/**
 * Update warmup inbox
 * (pause, resume, provider change, etc.)
 */
export async function updateWarmupInbox(req, res) {
  try {
    const { id } = req.params;
    const { status, provider } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "WarmupInbox id is required",
      });
    }

    if (status && !["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Allowed: ACTIVE, PAUSED",
      });
    }

    const inbox = await prisma.warmupInbox.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(provider && { provider }),
      },
    });

    return res.status(200).json({
      success: true,
      data: inbox,
    });
  } catch (error) {
    console.error("[updateWarmupInbox] error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Warmup inbox not found",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to update warmup inbox",
    });
  }
}
