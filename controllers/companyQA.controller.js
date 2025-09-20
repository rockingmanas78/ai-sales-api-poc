import prisma from "../utils/prisma.client.js";

// GET /api/company/qa
export const getAllCompanyQA = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { page = 1, limit = 10, category } = req.query;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = {
      CompanyProfile: {
        tenant_id: tenantId,
      },
      ...(category && { category }),
    };

    const qaList = await prisma.companyQA.findMany({
      where,
      skip,
      take,
    });

    res.json(qaList);
  } catch (err) {
    console.error("Error fetching company QAs:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /api/company/qa/:qaId
export const getCompanyQAById = async (req, res) => {
  try {
    const { qaId } = req.params;

    const qa = await prisma.companyQA.findUnique({
      where: { id: qaId },
    });

    if (!qa) {
      return res.status(404).json({ message: "QA not found" });
    }

    res.json(qa);
  } catch (err) {
    console.error("Error fetching QA by ID:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// POST /api/company/qa
export const createCompanyQABulk = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { questionAnswerList } = req.body; // Array of { question, answer, category? }

    if (!Array.isArray(questionAnswerList) || questionAnswerList.length === 0) {
      return res.status(400).json({ message: "Invalid QA list" });
    }

    const company = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!company) {
      return res.status(404).json({ message: "Company profile not found" });
    }

    // Fetch all existing questions for this company (case-insensitive, trimmed)
    const existingQAs = await prisma.companyQA.findMany({
      where: { company_id: company.id },
      select: { question: true },
    });
    const existingQuestions = new Set(
      existingQAs.map((q) => `${q.question}`.trim().toLowerCase())
    );

    // Remove duplicates within the same request (case-insensitive, trimmed)
    const seen = new Set();
    const uniqueNewQAs = [];
    for (const qa of questionAnswerList) {
      if (!qa.question) continue;
      const key = `${qa.question}`.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueNewQAs.push(qa);
      }
    }

    // Only add QAs whose question does not already exist for this company
    const newQAs = uniqueNewQAs.filter((qa) => {
      const key = `${qa.question}`.trim().toLowerCase();
      return !existingQuestions.has(key);
    });

    let created = [];
    if (newQAs.length > 0) {
      created = await prisma.$transaction(
        newQAs.map((qa) =>
          prisma.companyQA.create({
            data: {
              ...qa,
              company_id: company.id,
            },
          })
        )
      );
    }

    res.status(201).json({ message: "QAs created", created });
  } catch (err) {
    console.error("Error creating QA pairs:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH /api/company/qa/:qaId
export const updateCompanyQA = async (req, res) => {
  try {
    const { qaId } = req.params;
    const updateData = req.body;

    const existing = await prisma.companyQA.findUnique({
      where: { id: qaId },
    });

    if (!existing) {
      return res.status(404).json({ message: "QA not found" });
    }

    const updated = await prisma.companyQA.update({
      where: { id: qaId },
      data: updateData,
    });

    res.json(updated);
  } catch (err) {
    console.error("Error updating QA:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /api/company/qa/:qaId
export const deleteCompanyQA = async (req, res) => {
  try {
    const { qaId } = req.params;

    const existing = await prisma.companyQA.findUnique({
      where: { id: qaId },
    });

    if (!existing) {
      return res.status(404).json({ message: "QA not found" });
    }

    await prisma.companyQA.delete({
      where: { id: qaId },
    });

    res.json({ message: "QA deleted successfully" });
  } catch (err) {
    console.error("Error deleting QA:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
