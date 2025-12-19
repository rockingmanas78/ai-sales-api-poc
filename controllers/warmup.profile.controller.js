import { PrismaClient } from "@prisma/client";
import {
  assertEmailIdentityBelongsToTenantAndVerified,
} from "../services/warmup.validation.service.js";
import {
  normalizeWarmupMode,
  normalizeWarmupStatus,
} from "../services/warmup.normalizers.service.js";

const prisma = new PrismaClient();

/* =====================================================
   CREATE WARMUP PROFILE
===================================================== */
export async function createWarmupProfile(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { emailIdentityId, mode, targetDailyMax, providerHint, notes } =
      req.body;

    if (!tenantId || !emailIdentityId) {
      return res.status(400).json({
        error: "tenantId and emailIdentityId are required",
      });
    }

    // Ensure identity belongs to tenant & is verified
    await assertEmailIdentityBelongsToTenantAndVerified({
      tenantId,
      emailIdentityId,
    });

    // Prevent unique constraint crash
    const existing = await prisma.emailWarmupProfile.findFirst({
      where: { emailIdentityId },
    });

    if (existing) {
      return res.status(409).json({
        error: "Warmup profile already exists for this email identity",
      });
    }

    const createdProfile = await prisma.emailWarmupProfile.create({
      data: {
        tenantId,
        emailIdentityId,
        mode: normalizeWarmupMode(mode),
        status: "ACTIVE",
        targetDailyMax:
          Number.isFinite(Number(targetDailyMax)) &&
          Number(targetDailyMax) > 0
            ? Number(targetDailyMax)
            : 50,
        currentDailyMax: 5,
        providerHint: providerHint || null,
        notes: notes || null,
      },
      include: {
        EmailIdentity: {
          select: {
            id: true,
            emailAddress: true,
            verificationStatus: true,
          },
        },
      },
    });

    return res.json({
      message: "Warmup profile created",
      profile: createdProfile,
    });
  } catch (error) {
    next(error);
  }
}

/* =====================================================
   LIST WARMUP PROFILES
===================================================== */
export async function listWarmupProfiles(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    const profiles = await prisma.emailWarmupProfile.findMany({
      where: { tenantId },
      include: {
        EmailIdentity: {
          select: {
            id: true,
            emailAddress: true,
            verificationStatus: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ profiles });
  } catch (error) {
    next(error);
  }
}

/* =====================================================
   UPDATE WARMUP PROFILE
===================================================== */
export async function updateWarmupProfile(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const profileId = req.params.id;
    const { mode, status, targetDailyMax, notes } = req.body;

    const existingProfile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
    });

    if (!existingProfile) {
      return res.status(404).json({
        error: "Warmup profile not found",
      });
    }

    const updatedProfile = await prisma.emailWarmupProfile.update({
      where: { id: profileId },
      data: {
        ...(mode ? { mode: normalizeWarmupMode(mode) } : {}),
        ...(status ? { status: normalizeWarmupStatus(status) } : {}),
        ...(Number.isFinite(Number(targetDailyMax)) &&
        Number(targetDailyMax) > 0
          ? { targetDailyMax: Number(targetDailyMax) }
          : {}),
        ...(typeof notes === "string" ? { notes } : {}),
      },
    });

    return res.json({
      message: "Warmup profile updated",
      profile: updatedProfile,
    });
  } catch (error) {
    next(error);
  }
}

/* =====================================================
   GET WARMUP STATS
===================================================== */
export async function getWarmupStats(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { emailIdentityId, fromDate, toDate } = req.query;

    const filters = { tenantId };

    if (emailIdentityId) {
      // Safety: ensure identity belongs to tenant
      const identity = await prisma.emailIdentity.findFirst({
        where: {
          id: String(emailIdentityId),
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!identity) {
        return res.status(400).json({
          error: "Invalid emailIdentityId for this tenant",
        });
      }

      filters.emailIdentityId = String(emailIdentityId);
    }

    const where = {
      ...filters,
      ...(fromDate || toDate
        ? {
            date: {
              ...(fromDate ? { gte: new Date(String(fromDate)) } : {}),
              ...(toDate ? { lte: new Date(String(toDate)) } : {}),
            },
          }
        : {}),
    };

    const stats = await prisma.warmupDailyStat.findMany({
      where,
      orderBy: { date: "desc" },
      take: 120,
      include: {
        EmailIdentity: {
          select: { emailAddress: true },
        },
      },
    });

    return res.json({ stats });
  } catch (error) {
    next(error);
  }
}
