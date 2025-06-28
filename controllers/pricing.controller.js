import { PrismaClient } from '@prisma/client';
import flatten from "../utils/flatten.js";
const prisma = new PrismaClient();

export const getPricing = async (req, res) => {
  const zone = req.user?.zone || req.headers["x-user-zone"] || "ROW";
  const bucket = req.user?.bucket || "PUBLIC";

  try {
    const plans = await prisma.plan.findMany({
      where: {},
      include: {
        versions: {
          where: {
            zone,
            bucket: { in: [bucket, "PUBLIC"] },
            cadence: "MONTHLY"
          },
          orderBy: {
            version: "desc"
          },
          take: 1,
          include: {
            components: true
          }
        }
      }
    });

    res.json(flatten(plans));
  } catch (error) {
    console.error("Error fetching pricing plans:", error);
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
};
