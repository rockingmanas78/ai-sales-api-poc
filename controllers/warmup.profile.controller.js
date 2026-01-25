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
   Small helpers (minimal + readable)
===================================================== */
function getTenantIdFromRequest(req) {
  return req.user?.tenantId || req.body?.tenantId || null;
}

function isVerifiedIdentityStatus(verificationStatus) {
  const value = String(verificationStatus || "");
  return value === "Success" || value === "Verified";
}

async function ensureWarmupProfileBelongsToTenant({ tenantId, profileId }) {
  const profile = await prisma.emailWarmupProfile.findFirst({
    where: { id: profileId, tenantId },
    include: {
      EmailIdentity: {
        select: {
          id: true,
          emailAddress: true,
          verificationStatus: true,
          DomainIdentity: {
            select: { tenantId: true },
          },
        },
      },
    },
  });

  return profile;
}

async function getAvailableWarmupInboxesCount({ tenantId }) {
  return prisma.warmupInbox.count({
    where: {
      status: "ACTIVE",
      OR: [{ ownerTenantId: tenantId }, { ownerTenantId: null }],
    },
  });
}

async function selectWarmupInboxesForProfile({ tenantId, takeCount, excludeInboxIds }) {
  const excludedIds = Array.isArray(excludeInboxIds) ? excludeInboxIds : [];

  return prisma.warmupInbox.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ ownerTenantId: tenantId }, { ownerTenantId: null }],
      ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }],
    take: takeCount,
    select: { id: true }, // IMPORTANT: do not expose emails
  });
}

/* =====================================================
   CREATE WARMUP PROFILE
===================================================== */
export async function createWarmupProfile(req, res, next) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const { emailIdentityId, mode, targetDailyMax, providerHint, notes } = req.body;

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
        // ✅ PATCH: Do NOT auto-run on create. Start only via /start.
        status: "INACTIVE",
        targetDailyMax:
          Number.isFinite(Number(targetDailyMax)) && Number(targetDailyMax) > 0
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
      message: "Warmup profile created (not started yet)",
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
    const tenantId = getTenantIdFromRequest(req);

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

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
    const tenantId = getTenantIdFromRequest(req);
    const profileId = req.params.id;

    const {
      mode,
      status,
      targetDailyMax,
      startDailyVolume,
      rampUpDays,
      timezone,
      randomizeSending,
      notes,
    } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const existingProfile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
    });

    if (!existingProfile) {
      return res.status(404).json({ error: "Warmup profile not found" });
    }

    let newIncrementStep = existingProfile.incrementStep;

    const targetMaxValue =
      targetDailyMax !== undefined ? Number(targetDailyMax) : existingProfile.targetDailyMax;

    const startVolumeValue =
      startDailyVolume !== undefined ? Number(startDailyVolume) : existingProfile.startDailyVolume;

    const rampUpDaysValue =
      rampUpDays !== undefined ? Number(rampUpDays) : existingProfile.rampUpDays;

    if (Number.isFinite(rampUpDaysValue) && rampUpDaysValue > 0) {
      newIncrementStep = Math.max(1, Math.ceil((targetMaxValue - startVolumeValue) / rampUpDaysValue));
    }

    const updatedProfile = await prisma.emailWarmupProfile.update({
      where: { id: profileId },
      data: {
        ...(mode ? { mode: normalizeWarmupMode(mode) } : {}),
        ...(status ? { status: normalizeWarmupStatus(status) } : {}),
        ...(Number.isFinite(Number(targetDailyMax)) ? { targetDailyMax: Number(targetDailyMax) } : {}),
        ...(Number.isFinite(Number(startDailyVolume)) ? { startDailyVolume: Number(startDailyVolume) } : {}),
        ...(Number.isFinite(Number(rampUpDays)) ? { rampUpDays: Number(rampUpDays) } : {}),
        incrementStep: newIncrementStep,
        ...(timezone ? { timezone } : {}),
        ...(randomizeSending !== undefined ? { randomizeSending: Boolean(randomizeSending) } : {}),
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
    const tenantId = getTenantIdFromRequest(req);
    const { emailIdentityId, fromDate, toDate } = req.query;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const filters = { tenantId };

    if (emailIdentityId) {
      const identity = await prisma.emailIdentity.findFirst({
        where: {
          id: String(emailIdentityId),
          DomainIdentity: { tenantId },
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

/* =====================================================
   GET WARMUP PROFILE BY ID
===================================================== */
export async function getWarmupProfileById(req, res, next) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const profileId = req.params.id;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const profile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
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

    if (!profile) {
      return res.status(404).json({ error: "Warmup profile not found" });
    }

    return res.json(profile);
  } catch (error) {
    next(error);
  }
}

/* =====================================================
   NEW: START WARMUP PROFILE (Auto-assign inboxes)
   POST /api/warmup/profile/start/:profileId
   Body: { inboxCount?: number }
===================================================== */
export async function startWarmupProfile(req, res) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const profileId = req.params.profileId;

    if (!tenantId || !profileId) {
      return res.status(400).json({
        success: false,
        error: "tenantId and profileId are required",
      });
    }

    const requestedInboxCountRaw = req.body?.inboxCount;
    const requestedInboxCountNumber = Number(requestedInboxCountRaw);
    const requestedInboxCount =
      Number.isFinite(requestedInboxCountNumber) && requestedInboxCountNumber > 0
        ? Math.floor(requestedInboxCountNumber)
        : 2;

    const profile = await ensureWarmupProfileBelongsToTenant({ tenantId, profileId });

    if (!profile) {
      return res.status(404).json({ success: false, error: "Warmup profile not found" });
    }

    if (profile.mode !== "AUTO") {
      return res.status(400).json({
        success: false,
        error: "Warmup profile mode must be AUTO to start",
      });
    }

    const identityRow = profile.EmailIdentity;
    if (!identityRow || !isVerifiedIdentityStatus(identityRow.verificationStatus)) {
      return res.status(400).json({
        success: false,
        error: "Email identity must be verified before starting warmup",
      });
    }

    const availableInboxes = await getAvailableWarmupInboxesCount({ tenantId });
    if (!availableInboxes) {
      return res.status(400).json({
        success: false,
        error: "No warmup inboxes available right now",
      });
    }

    const finalInboxCount = Math.min(requestedInboxCount, availableInboxes);

    // Find existing mappings (so we don't duplicate)
    const existingMappings = await prisma.warmupProfileInbox.findMany({
      where: {
        tenant_id: tenantId,
        profile_id: profileId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: { warmup_inbox_id: true },
    });

    const alreadyMappedInboxIds = existingMappings.map((m) => m.warmup_inbox_id);

    // If already has enough inboxes, just activate the profile
    if (alreadyMappedInboxIds.length >= finalInboxCount) {
      const updated = await prisma.emailWarmupProfile.update({
        where: { id: profileId },
        data: { status: "ACTIVE" },
      });

      return res.status(200).json({
        success: true,
        message: "Warmup started successfully",
        data: {
          profileId: updated.id,
          status: updated.status,
          assignedInboxes: alreadyMappedInboxIds.length,
        },
      });
    }

    const neededMore = finalInboxCount - alreadyMappedInboxIds.length;

    const selectedInboxRows = await selectWarmupInboxesForProfile({
      tenantId,
      takeCount: neededMore,
      excludeInboxIds: alreadyMappedInboxIds,
    });

    if (!selectedInboxRows.length && alreadyMappedInboxIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Unable to assign warmup inboxes",
      });
    }

    await prisma.$transaction(async (tx) => {
      if (selectedInboxRows.length) {
        await tx.warmupProfileInbox.createMany({
          data: selectedInboxRows.map((row) => ({
            tenant_id: tenantId,
            profile_id: profileId,
            warmup_inbox_id: row.id,
            status: "ACTIVE",
            weight: 1,
          })),
          skipDuplicates: true,
        });
      }

      await tx.emailWarmupProfile.update({
        where: { id: profileId },
        data: { status: "ACTIVE" },
      });
    });

    const finalMappings = await prisma.warmupProfileInbox.count({
      where: { tenant_id: tenantId, profile_id: profileId, status: { in: ["ACTIVE", "PAUSED"] } },
    });

    return res.status(200).json({
      success: true,
      message: "Warmup started successfully",
      data: {
        profileId,
        status: "ACTIVE",
        assignedInboxes: finalMappings,
      },
    });
  } catch (error) {
    console.error("[startWarmupProfile] error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to start warmup profile",
    });
  }
}

/* =====================================================
   NEW: PAUSE WARMUP PROFILE
   POST /api/warmup/profile/pause/:profileId
===================================================== */
export async function pauseWarmupProfile(req, res) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const profileId = req.params.profileId;

    if (!tenantId || !profileId) {
      return res.status(400).json({ success: false, error: "tenantId and profileId are required" });
    }

    const profile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
      select: { id: true, status: true },
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: "Warmup profile not found" });
    }

    const updated = await prisma.emailWarmupProfile.update({
      where: { id: profileId },
      data: { status: "PAUSED" },
    });

    return res.status(200).json({
      success: true,
      message: "Warmup paused",
      data: { profileId: updated.id, status: updated.status },
    });
  } catch (error) {
    console.error("[pauseWarmupProfile] error:", error);
    return res.status(500).json({ success: false, error: "Failed to pause warmup profile" });
  }
}

/* =====================================================
   NEW: RESUME WARMUP PROFILE
   POST /api/warmup/profile/resume/:profileId
===================================================== */
export async function resumeWarmupProfile(req, res) {
  try {
    const tenantId = getTenantIdFromRequest(req);
    const profileId = req.params.profileId;

    if (!tenantId || !profileId) {
      return res.status(400).json({ success: false, error: "tenantId and profileId are required" });
    }

    const profile = await prisma.emailWarmupProfile.findFirst({
      where: { id: profileId, tenantId },
      select: { id: true, mode: true },
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: "Warmup profile not found" });
    }

    if (profile.mode !== "AUTO") {
      return res.status(400).json({ success: false, error: "Warmup profile mode must be AUTO to resume" });
    }

    const mappingCount = await prisma.warmupProfileInbox.count({
      where: {
        tenant_id: tenantId,
        profile_id: profileId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
    });

    if (!mappingCount) {
      return res.status(400).json({
        success: false,
        error: "No inboxes are assigned to this profile. Please start warmup first.",
      });
    }

    const updated = await prisma.emailWarmupProfile.update({
      where: { id: profileId },
      data: { status: "ACTIVE" },
    });

    return res.status(200).json({
      success: true,
      message: "Warmup resumed",
      data: { profileId: updated.id, status: updated.status },
    });
  } catch (error) {
    console.error("[resumeWarmupProfile] error:", error);
    return res.status(500).json({ success: false, error: "Failed to resume warmup profile" });
  }
}



// import { PrismaClient } from "@prisma/client";
// import {
//   assertEmailIdentityBelongsToTenantAndVerified,
// } from "../services/warmup.validation.service.js";
// import {
//   normalizeWarmupMode,
//   normalizeWarmupStatus,
// } from "../services/warmup.normalizers.service.js";

// const prisma = new PrismaClient();

// /* =====================================================
//    CREATE WARMUP PROFILE
// ===================================================== */
// export async function createWarmupProfile(req, res, next) {
//   try {
//     // const tenantId = req.user?.tenantId;
//     const {tenantId, emailIdentityId, mode, targetDailyMax, providerHint, notes } =
//       req.body;

//     console.log("Creating warmup profile", { tenantId, emailIdentityId, mode, targetDailyMax });

//     if (!tenantId || !emailIdentityId) {
//       return res.status(400).json({
//         error: "tenantId and emailIdentityId are required",
//       });
//     }

//     // Ensure identity belongs to tenant & is verified
//     await assertEmailIdentityBelongsToTenantAndVerified({
//       tenantId,
//       emailIdentityId,
//     });

//     // Prevent unique constraint crash
//     const existing = await prisma.emailWarmupProfile.findFirst({
//       where: { emailIdentityId },
//     });

//     if (existing) {
//       return res.status(409).json({
//         error: "Warmup profile already exists for this email identity",
//       });
//     }

//     const createdProfile = await prisma.emailWarmupProfile.create({
//       data: {
//         tenantId,
//         emailIdentityId,
//         mode: normalizeWarmupMode(mode),
//         status: "ACTIVE",
//         targetDailyMax:
//           Number.isFinite(Number(targetDailyMax)) &&
//           Number(targetDailyMax) > 0
//             ? Number(targetDailyMax)
//             : 50,
//         currentDailyMax: 5,
//         providerHint: providerHint || null,
//         notes: notes || null,
//       },
//       include: {
//         EmailIdentity: {
//           select: {
//             id: true,
//             emailAddress: true,
//             verificationStatus: true,
//           },
//         },
//       },
//     });

//     return res.json({
//       message: "Warmup profile created",
//       profile: createdProfile,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// /* =====================================================
//    LIST WARMUP PROFILES
// ===================================================== */
// export async function listWarmupProfiles(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;

//     const profiles = await prisma.emailWarmupProfile.findMany({
//       where: { tenantId },
//       include: {
//         EmailIdentity: {
//           select: {
//             id: true,
//             emailAddress: true,
//             verificationStatus: true,
//           },
//         },
//       },
//       orderBy: { createdAt: "desc" },
//     });

//     return res.json({ profiles });
//   } catch (error) {
//     next(error);
//   }
// }

// /* =====================================================
//    UPDATE WARMUP PROFILE
// ===================================================== */
// export async function updateWarmupProfile(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const profileId = req.params.id;
//     const { 
//       mode, 
//       status, 
//       targetDailyMax, 
//       startDailyVolume,
//       rampUpDays,
//       timezone,
//       randomizeSending,
//       notes 
//     } = req.body;

//     const existingProfile = await prisma.emailWarmupProfile.findFirst({
//       where: { id: profileId, tenantId },
//     });

//     if (!existingProfile) {
//       return res.status(404).json({ error: "Warmup profile not found" });
//     }

//     // Optional: Auto-calculate incrementStep if rampUpDays is provided
//     let newIncrementStep = existingProfile.incrementStep;
    
//     // If user changes target or start volume, recalculate step to fit the ramp-up days
//     // Formula: (Target - Start) / Days = Daily Step
//     const tMax = targetDailyMax !== undefined ? Number(targetDailyMax) : existingProfile.targetDailyMax;
//     const sVol = startDailyVolume !== undefined ? Number(startDailyVolume) : existingProfile.startDailyVolume;
//     const rDays = rampUpDays !== undefined ? Number(rampUpDays) : existingProfile.rampUpDays;
    
//     if (rDays > 0) {
//       newIncrementStep = Math.max(1, Math.ceil((tMax - sVol) / rDays));
//     }

//     const updatedProfile = await prisma.emailWarmupProfile.update({
//       where: { id: profileId },
//       data: {
//         ...(mode ? { mode: normalizeWarmupMode(mode) } : {}),
//         ...(status ? { status: normalizeWarmupStatus(status) } : {}),
        
//         // Number validations
//         ...(Number.isFinite(Number(targetDailyMax)) ? { targetDailyMax: Number(targetDailyMax) } : {}),
//         ...(Number.isFinite(Number(startDailyVolume)) ? { startDailyVolume: Number(startDailyVolume) } : {}),
//         ...(Number.isFinite(Number(rampUpDays)) ? { rampUpDays: Number(rampUpDays) } : {}),
        
//         incrementStep: newIncrementStep,
        
//         ...(timezone ? { timezone } : {}),
//         ...(randomizeSending !== undefined ? { randomizeSending: Boolean(randomizeSending) } : {}),
//         ...(typeof notes === "string" ? { notes } : {}),
//       },
//     });

//     return res.json({
//       message: "Warmup profile updated",
//       profile: updatedProfile,
//     });
//   } catch (error) {
//     next(error);
//   }
// }

// /* =====================================================
//    GET WARMUP STATS
// ===================================================== */
// export async function getWarmupStats(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const { emailIdentityId, fromDate, toDate } = req.query;

//     const filters = { tenantId };

//     if (emailIdentityId) {
//       // Safety: ensure identity belongs to tenant
//       const identity = await prisma.emailIdentity.findFirst({
//         where: {
//           id: String(emailIdentityId),
//           // CHANGE THIS: 'tenantId' is NOT directly on emailIdentity, 
//           // it is on the DomainIdentity relation.
//           DomainIdentity: {
//             tenantId
//           },
//           deletedAt: null,
//         },
//         select: { id: true },
//       });

//       if (!identity) {
//         return res.status(400).json({
//           error: "Invalid emailIdentityId for this tenant",
//         });
//       }

//       filters.emailIdentityId = String(emailIdentityId);
//     }

//     const where = {
//       ...filters,
//       ...(fromDate || toDate
//         ? {
//             date: {
//               ...(fromDate ? { gte: new Date(String(fromDate)) } : {}),
//               ...(toDate ? { lte: new Date(String(toDate)) } : {}),
//             },
//           }
//         : {}),
//     };

//     const stats = await prisma.warmupDailyStat.findMany({
//       where,
//       orderBy: { date: "desc" },
//       take: 120,
//       include: {
//         EmailIdentity: {
//           select: { emailAddress: true },
//         },
//       },
//     });

//     return res.json({ stats });
//   } catch (error) {
//     next(error);
//   }
// }

// /* =====================================================
//    GET WARMUP PROFILE BY ID
// ===================================================== */
// export async function getWarmupProfileById(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const profileId = req.params.id;

//     if (!tenantId) {
//       return res.status(401).json({ error: "Unauthorized" });
//     }

//     const profile = await prisma.emailWarmupProfile.findFirst({
//       where: {
//         id: profileId,
//         tenantId, // ✅ tenant safety
//       },
//       include: {
//         EmailIdentity: {
//           select: {
//             id: true,
//             emailAddress: true,
//             verificationStatus: true,
//           },
//         },
//       },
//     });

//     if (!profile) {
//       return res.status(404).json({ error: "Warmup profile not found" });
//     }

//     return res.json(profile);
//   } catch (error) {
//     next(error);
//   }
// }
