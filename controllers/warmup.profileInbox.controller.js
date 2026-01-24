import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * GET /api/warmup-profiles/:profileId/inboxes
 * Lists inbox mappings for a profile (WarmupProfileInbox) including WarmupInbox details.
 */
export async function listWarmupProfileInboxes(req, res) {
  try {
    const tenantId = req.user?.tenantId || req.body?.tenantId;
    const profileId = req.params.profileId;

    if (!tenantId || !profileId) {
      return res.status(400).json({
        success: false,
        error: "tenantId and profileId are required",
      });
    }

    // Ensure profile belongs to tenant
    const profile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
      select: { id: true },
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Warmup profile not found",
      });
    }

    const mappings = await prisma.warmupProfileInbox.findMany({
      where: {
        tenant_id: tenantId,
        profile_id: profileId,
      },
      orderBy: [{ status: "asc" }, { created_at: "desc" }],
      select: {
        id: true,
        warmup_inbox_id: true,
        status: true,
        weight: true,
        created_at: true,
        updated_at: true,
        WarmupInbox: {
          select: {
            id: true,
            email: true,
            provider: true,
            domain: true,
            status: true,
            maxDailyVolume: true,
            autoEngagementEnabled: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      data: mappings,
    });
  } catch (error) {
    console.error("[listWarmupProfileInboxes] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch profile inbox mappings",
    });
  }
}

/**
 * PUT /api/warmup-profiles/:profileId/inboxes
 * Replaces the mapping set for a profile.
 *
 * Body:
 * {
 *   "inboxes": [
 *     { "warmupInboxId": "...uuid...", "status": "ACTIVE", "weight": 1 },
 *     ...
 *   ]
 * }
 */
export async function replaceWarmupProfileInboxes(req, res) {
  try {
    const tenantId = req.user?.tenantId || req.body?.tenantId;
    const profileId = req.params.profileId;

    const inboxes = Array.isArray(req.body?.inboxes) ? req.body.inboxes : [];

    if (!tenantId || !profileId) {
      return res.status(400).json({
        success: false,
        error: "tenantId and profileId are required",
      });
    }

    // Ensure profile belongs to tenant
    const profile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
      select: { id: true },
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Warmup profile not found",
      });
    }

    // Validate inbox ids exist (only those provided)
    const warmupInboxIdList = inboxes
      .map((row) => String(row?.warmupInboxId || "").trim())
      .filter(Boolean);

    const uniqueWarmupInboxIdList = [...new Set(warmupInboxIdList)];

    if (!uniqueWarmupInboxIdList.length) {
      // If caller wants empty set, we delete all mappings for this profile
      await prisma.warmupProfileInbox.deleteMany({
        where: { tenant_id: tenantId, profile_id: profileId },
      });

      return res.status(200).json({
        success: true,
        message: "All profile inbox mappings removed",
      });
    }

    const existingInboxRows = await prisma.warmupInbox.findMany({
      where: { id: { in: uniqueWarmupInboxIdList } },
      select: { id: true },
    });

    const existingIdSet = new Set(existingInboxRows.map((row) => row.id));
    const missingIds = uniqueWarmupInboxIdList.filter((id) => !existingIdSet.has(id));

    if (missingIds.length) {
      return res.status(400).json({
        success: false,
        error: "Some warmupInboxId values do not exist",
        missingIds,
      });
    }

    // Transaction: upsert provided mappings, delete missing mappings
    const result = await prisma.$transaction(async (transactionClient) => {
      // Delete mappings not in the new list
      await transactionClient.warmupProfileInbox.deleteMany({
        where: {
          tenant_id: tenantId,
          profile_id: profileId,
          warmup_inbox_id: { notIn: uniqueWarmupInboxIdList },
        },
      });

      // Upsert each provided mapping
      const upsertedMappings = [];

      for (const inboxRow of inboxes) {
        const warmupInboxId = String(inboxRow?.warmupInboxId || "").trim();
        if (!warmupInboxId) continue;

        const statusRaw = String(inboxRow?.status || "ACTIVE").toUpperCase();
        const status =
          statusRaw === "PAUSED" ? "PAUSED" :
          statusRaw === "DISABLED" ? "DISABLED" :
          "ACTIVE";

        const weightValue = Number(inboxRow?.weight || 1);
        const weight = Number.isFinite(weightValue) && weightValue > 0 ? Math.floor(weightValue) : 1;

        const mapping = await transactionClient.warmupProfileInbox.upsert({
          where: {
            warmup_profile_inbox_uq: {
              tenant_id: tenantId,
              profile_id: profileId,
              warmup_inbox_id: warmupInboxId,
            },
          },
          create: {
            tenant_id: tenantId,
            profile_id: profileId,
            warmup_inbox_id: warmupInboxId,
            status,
            weight,
          },
          update: {
            status,
            weight,
            updated_at: new Date(),
          },
        });

        upsertedMappings.push(mapping);
      }

      return upsertedMappings;
    });

    return res.status(200).json({
      success: true,
      message: "Profile inbox mappings updated",
      data: result,
    });
  } catch (error) {
    console.error("[replaceWarmupProfileInboxes] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update profile inbox mappings",
    });
  }
}

/**
 * PATCH /api/warmup-profiles/:profileId/inboxes/:warmupInboxId
 * Updates a single mapping status/weight.
 */
export async function updateWarmupProfileInbox(req, res) {
  try {
    const tenantId = req.user?.tenantId || req.body?.tenantId;
    const profileId = req.params.profileId;
    const warmupInboxId = req.params.warmupInboxId;

    const statusRaw = req.body?.status ? String(req.body.status).toUpperCase() : null;
    const weightRaw = req.body?.weight !== undefined ? Number(req.body.weight) : null;

    if (!tenantId || !profileId || !warmupInboxId) {
      return res.status(400).json({
        success: false,
        error: "tenantId, profileId and warmupInboxId are required",
      });
    }

    const mapping = await prisma.warmupProfileInbox.findFirst({
      where: {
        tenant_id: tenantId,
        profile_id: profileId,
        warmup_inbox_id: warmupInboxId,
      },
      select: { id: true },
    });

    if (!mapping) {
      return res.status(404).json({
        success: false,
        error: "Profile inbox mapping not found",
      });
    }

    let updatedStatus = undefined;
    if (statusRaw) {
      updatedStatus =
        statusRaw === "PAUSED" ? "PAUSED" :
        statusRaw === "DISABLED" ? "DISABLED" :
        statusRaw === "ACTIVE" ? "ACTIVE" :
        undefined;

      if (!updatedStatus) {
        return res.status(400).json({
          success: false,
          error: "Invalid status. Allowed: ACTIVE, PAUSED, DISABLED",
        });
      }
    }

    let updatedWeight = undefined;
    if (weightRaw !== null) {
      if (!Number.isFinite(weightRaw) || weightRaw <= 0) {
        return res.status(400).json({
          success: false,
          error: "weight must be a positive number",
        });
      }
      updatedWeight = Math.floor(weightRaw);
    }

    const updated = await prisma.warmupProfileInbox.update({
      where: { id: mapping.id },
      data: {
        ...(updatedStatus ? { status: updatedStatus } : {}),
        ...(updatedWeight ? { weight: updatedWeight } : {}),
        updated_at: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[updateWarmupProfileInbox] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update profile inbox mapping",
    });
  }
}
