import { ingestCompanyProfile } from "../services/ai.service.js";
import prisma from "../utils/prisma.client.js";

export const getCompanyProfile = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;

    const profile = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
      //include: { CompanyQA: true, Product: true }
    });

    if (!profile) {
      return res.json(null);
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createCompanyProfile = async (req, res) => {
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(400).json({ message: "Missing tenant ID in user context" });
  }

  const data = { ...req.body, tenant_id: tenantId };
  let created;

  try {
    created = await prisma.companyProfile.create({ data });
  } catch (dbError) {
    // Optionally use instanceof Prisma.PrismaClientKnownRequestError and dbError.code for finer control
    console.error("Prisma error creating company profile:", dbError);
    return res.status(500).json({ message: "Failed to create company profile", error: dbError.message });
  }

  try {
    const resp = await ingestCompanyProfile(created.id, req.headers);
    console.log(resp)
  } catch (aiError) {
    console.error("AI ingestion error:", aiError);
    // Optionally update DB or send a notification about the ingestion failure
    return res.status(502).json({ message: "Company created but ingestion failed", error: aiError.message, record: created });
  }

  return res.status(201).json(created);
};


export const upsertCompanyProfile = async (req, res) => {
  try {
    const { companyId } = req.params;
    const tenantId = req.user.tenantId;

    const data = { ...req.body, tenant_id: tenantId };

    const updated = await prisma.companyProfile.upsert({
      where: { id: companyId },
      update: data,
      create: data,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error upserting company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteCompanyProfile = async (req, res) => {
  try {
    const { companyId } = req.params;

    const existing = await prisma.companyProfile.findUnique({
      where: { id: companyId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Company profile not found" });
    }

    await prisma.companyProfile.delete({
      where: { id: companyId },
    });

    res.status(200).json({ message: "Company profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
