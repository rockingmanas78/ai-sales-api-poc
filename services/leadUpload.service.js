import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const bulkUploadLeads = async (leads, tenantId) => {
  const formattedLeads = leads.map((lead) => ({
    tenantId,
    companyName: lead.companyName || '',
    contactEmail: lead.contactEmail ? [lead.contactEmail] : [], //wrap in array
    contactPhone: lead.contactPhone ? [lead.contactPhone] : [], //wrap in array
    contactName: lead.contactName || '',
    confidence: lead.confidence ? parseFloat(lead.confidence) : null,
    metadata: lead.metadata ? JSON.parse(lead.metadata) : {},
    contactAddress: lead.contactAddress ? [lead.contactAddress] : [], //optional but safe
  }));

  const result = await prisma.lead.createMany({
    data: formattedLeads,
    skipDuplicates: true,
  });

  return result;
};
