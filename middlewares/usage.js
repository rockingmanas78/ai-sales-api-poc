import { PrismaClient, MeterMetric } from "@prisma/client";
const prisma = new PrismaClient();

/**
 * A unified, transactional function to check all limits and record usage.
 * This is the new core of the quota system.
 *
 * @param {string} tenantId - The ID of the tenant.
 * @param {import('@prisma/client').MeterMetric} metric - The metric being consumed (e.g., 'JOB').
 * @param {number} quantity - The amount of usage to record (usually 1).
 * @returns {Promise<{allowed: boolean, reason?: string, status?: number}>}
 */
const checkAndRecordUsage = async (tenantId, metric, quantity = 1) => {
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find the tenant's active subscription to get the correct plan.
      const subscription = await tx.subscription.findFirst({
        where: {
          tenantId: tenantId,
          status: "ACTIVE",
          // currentStart: { lte: now },
          // currentEnd: { gt: now },
        },
        orderBy: { currentStart: "desc" },
      });

      // if (!subscription) {
      //   return {
      //     allowed: false,
      //     reason: "No active subscription found.",
      //     status: 403,
      //   };
      // }

      // const isSubscriptionActive =
      // //   now >= subscription.currentStart && now < subscription.currentEnd;
      // if (!isSubscriptionActive) {
      //   return {
      //     allowed: false,
      //     reason: "No active subscription found for the current date.",
      //     status: 403,
      //   };
      // }

      // 2. Fetch the plan's components (the actual limits) for the given metric.
      const planVersion = await tx.planVersion.findUnique({
        where: { id: subscription.planVersionId },
        include: {
          components: { where: { metric: metric } },
        },
      });

      if (!planVersion || planVersion.components.length === 0) {
        return { allowed: true };
      }

      const dailyLimitComponent = planVersion.components.find(
        (c) => c.capPeriod === "DAY"
      );
      const monthlyLimitComponent = planVersion.components.find(
        (c) => c.capPeriod === "PERIOD" || c.capPeriod === "MONTH"
      );

      // --- 3. Perform Limit Checks within the transaction ---

      // Daily Check
      if (dailyLimitComponent) {
        const dailyLimit = dailyLimitComponent.includedQty;
        // MODIFICATION: Only check the limit if it is non-negative.
        if (dailyLimit >= 0) {
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          const dailyUsage = await tx.dailyCapCounter.findUnique({
            where: { tenantId_date_metric: { tenantId, date: today, metric } },
          });

          const currentDailyCount = dailyUsage ? dailyUsage.qty : 0;
          if (currentDailyCount + quantity > dailyLimit) {
            return {
              allowed: false,
              reason: `You have reached your daily limit of ${dailyLimit}.`,
              status: 429,
            };
          }
        }
      }
      if (monthlyLimitComponent) {
        const monthlyLimit = monthlyLimitComponent.includedQty;
        // FIX #2: Added the missing check for non-negative limits.
        if (monthlyLimit >= 0) {
          const monthStart = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
          );

          const monthlyUsage = await tx.usageEvent.aggregate({
            _sum: { qty: true },
            where: { tenantId, metric, recordedAt: { gte: monthStart } },
          });

          const currentMonthlyCount = monthlyUsage._sum.qty || 0;
          if (currentMonthlyCount + quantity > monthlyLimit) {
            return {
              allowed: false,
              reason: `You have reached your monthly limit of ${monthlyLimit}.`,
              status: 429,
            };
          }
        }
      }
      // // Daily Check
      // if (dailyLimitComponent) {
      //   const dailyLimit = dailyLimitComponent.includedQty;
      //   const today = new Date();
      //   today.setUTCHours(0, 0, 0, 0);

      //   const dailyUsage = await tx.dailyCapCounter.findUnique({
      //     where: { tenantId_date_metric: { tenantId, date: today, metric } },
      //   });

      //   const currentDailyCount = dailyUsage ? dailyUsage.qty : 0;
      //   if (currentDailyCount + quantity > dailyLimit) {
      //     throw new Error(
      //       `DAILY_LIMIT: You have reached your daily limit of ${dailyLimit}.`
      //     );
      //   }
      // }

      // // Monthly Check
      // if (monthlyLimitComponent) {
      //   const monthlyLimit = monthlyLimitComponent.includedQty;
      //   const monthStart = new Date(
      //     Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) // Correctly using getUTCMonth()
      //   );

      //   const monthlyUsage = await tx.usageEvent.aggregate({
      //     _sum: { qty: true },
      //     where: { tenantId, metric, recordedAt: { gte: monthStart } },
      //   });

      //   const currentMonthlyCount = monthlyUsage._sum.qty || 0;
      //   if (currentMonthlyCount + quantity > monthlyLimit) {
      //     throw new Error(
      //       `MONTHLY_LIMIT: You have reached your monthly limit of ${monthlyLimit}.`
      //     );
      //   }
      // }

      // --- 4. If all checks pass, record usage within the same transaction ---
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      await tx.usageEvent.create({
        data: { tenantId, metric, qty: quantity },
      });

      await tx.dailyCapCounter.upsert({
        where: { tenantId_date_metric: { tenantId, date: today, metric } },
        update: { qty: { increment: quantity } },
        create: { tenantId, date: today, metric, qty: quantity },
      });
      console.log("Done");

      return { allowed: true };
    });

    return result;
    // ... inside searchAndExtract function
  } catch (err) {
    // --- MODIFICATION START ---
    // Log the entire error object to get more details in your terminal.
    console.error("--- Full Axios Error in searchAndExtract ---");
    console.error(err);
    console.error("--------------------------------------------");

    // Provide a more specific error response to the client.
    if (err.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const { status, data } = err.response;
      if (status === 404) {
        return res.status(502).json({
          error: "Bad Gateway: The AI service endpoint could not be found.",
          details: `Attempted to reach ${err.config.url}`,
        });
      }
      return res.status(status).json({
        error: "Error from AI service.",
        details: data,
      });
    } else if (err.request) {
      // The request was made but no response was received
      return res.status(504).json({
        error: "Gateway Timeout: No response from the AI service.",
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      return res.status(500).json({ error: "Internal server error." });
    }
    // --- MODIFICATION END ---
  }
};

/**
 * Middleware to check event-based usage limits.
 * @param {import('@prisma/client').MeterMetric} metric - The usage metric to check (e.g., MeterMetric.JOB).
 */
export const checkEventUsageLimits = (metric, count) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.tenantId) {
        return res.status(401).json({
          error: "Authentication error: User or Tenant ID not found.",
        });
      }
      const { tenantId } = req.user;

      const result = await checkAndRecordUsage(tenantId, metric, count);

      if (!result.allowed) {
        return res.status(result.status || 429).json({ error: result.reason });
      }

      next();
    } catch (error) {
      console.error(`Error in usage middleware for metric [${metric}]:`, error);
      res
        .status(500)
        .json({ error: "Internal Server Error while checking usage." });
    }
  };
};

/**
 * Middleware to check the state-based 'SEAT' limit for a tenant.
 */
export const checkSeatAvailability = async (req, res, next) => {
  try {
    if (!req.user || !req.user.tenantId) {
      return res
        .status(401)
        .json({ error: "Authentication error: Tenant ID not found." });
    }
    const { tenantId } = req.user;

    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: tenantId, status: "ACTIVE" },
      orderBy: { currentStart: "desc" },
    });

    if (!subscription) {
      return res
        .status(403)
        .json({ error: "No active subscription found to check seat limits." });
    }

    const planVersion = await prisma.planVersion.findUnique({
      where: { id: subscription.planVersionId },
      include: {
        components: { where: { metric: MeterMetric.SEAT } }, // Using enum for type safety
      },
    });

    const seatComponent = planVersion?.components[0];
    if (!seatComponent) {
      return next();
    }

    const seatLimit = seatComponent.includedQty;
    //If seatLimit is -1, it means unlimited seats.
    if (seatLimit === -1) {
      return next(); // Allow the request to proceed without checking the limit.
    }
    const currentUserCount = await prisma.user.count({
      where: { tenantId: tenantId, deletedAt: null },
    });

    if (currentUserCount >= seatLimit) {
      return res.status(429).json({
        error: `You have reached your limit of ${seatLimit} user seats. Please upgrade your plan to add more users.`,
      });
    }

    next();
  } catch (error) {
    console.error("Error in checkSeatAvailability middleware:", error);
    res.status(500).json({
      error: "Internal Server Error while checking seat availability.",
    });
  }
};
