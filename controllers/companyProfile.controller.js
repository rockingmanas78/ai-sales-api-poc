import prisma from '../utils/prisma.client.js';


export const getCompanyProfile = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;

    const profile = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
      //include: { CompanyQA: true, Product: true }
    });

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.json(profile);
  } catch (error) {
    console.error("Error fetching company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createCompanyProfile = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const data = { ...req.body, tenant_id: tenantId };

    const created = await prisma.companyProfile.create({ data });
    res.status(201).json(created);
  } catch (error) {
    console.error("Error creating company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const upsertCompanyProfile = async (req, res) => {
  try {
    const { companyId } = req.params;
    const tenantId = req.user.tenantId;

    const data = { ...req.body, tenant_id: tenantId };

    const updated = await prisma.companyProfile.upsert({
      where: { id: companyId },
      update: data,
      create: data
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
      where: { id: companyId }
    });

    if (!existing) {
      return res.status(404).json({ message: "Company profile not found" });
    }

    await prisma.companyProfile.delete({
      where: { id: companyId }
    });

    res.status(200).json({ message: "Company profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting company profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


