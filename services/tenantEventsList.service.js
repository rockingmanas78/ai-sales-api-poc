import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function getTenantScheduledEvents(tenantId) {
  if (!tenantId) throw new Error("tenantId is required");
  return prisma.emailMessage.findMany({
    where: {
      tenantId,
      sentAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}
