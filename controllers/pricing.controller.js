import { quotePlanWithTax } from "../services/payment.service.js";
import { PrismaClient } from "@prisma/client";
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
            cadence: "MONTHLY",
          },
          orderBy: {
            version: "desc",
          },
          take: 1,
          include: {
            components: true,
          },
        },
      },
    });

    res.json(flatten(plans));
  } catch (error) {
    console.error("Error fetching pricing plans:", error);
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
};

export async function getQuote(req, res) {
  try {
    const { plan, cycle, zone } = req.body;
    const zoneCode =
      zone || (req.resolveZoneCode ? await req.resolveZoneCode(req) : "IN");
    const q = await quotePlanWithTax({ plan, zoneCode, cycle });
    res.status(200).json({ success: true, data: q });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
}
