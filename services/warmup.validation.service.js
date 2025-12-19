import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function assertEmailIdentityBelongsToTenantAndVerified({ tenantId, emailIdentityId }) {
  const emailIdentity = await prisma.emailIdentity.findFirst({
    where: {
      id: emailIdentityId,
      domain: { tenantId },
      deletedAt: null,
      verificationStatus: { in: ["Success", "Verified"] },
    },
    select: { id: true, emailAddress: true },
  });
  if (!emailIdentity) {
    const error = new Error("Email identity not found or not verified for this tenant");
    error.statusCode = 400;
    throw error;
  }
  return emailIdentity;
}
