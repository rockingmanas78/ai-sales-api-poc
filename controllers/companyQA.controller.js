import { ingestCompanyQa } from "../services/ai.service.js";
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

    const existingQAs = await prisma.companyQA.findMany({
      where: { company_id: company.id },
      select: { question: true },
    });
    const existingQuestions = new Set(
      existingQAs.map((q) => `${q.question}`.trim().toLowerCase())
    );

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
    // --- End duplicate checking ---

    let aiData = []; // Default to an empty array
    
    if (created.length > 0) {
      const authHeader = req.headers;
      if (!authHeader?.authorization) { // Check for auth specifically
        console.warn(
          "No auth header found; skipping ingestion for new Company QAs."
        );
      } else {
        console.log(`Triggering ingestion for ${created.length} new Company QAs...`);
        
        const ingestPromises = created.map((qa) =>
          ingestCompanyQa(qa.id, authHeader)
        );

        const results = await Promise.allSettled(ingestPromises);

        // --- START OF FIX ---
        // Process the results into a clean, serializable array
        aiData = results.map((result, index) => {
          if (result.status === "fulfilled") {
            // Success: return only the AI service's response *data*
            return {
              status: "fulfilled",
              qa_id: created[index].id,
              data: result.value.data, // This is serializable
            };
          } else {
            // Failure: log the complex error, return a simple one
            const errorMsg = result.reason?.response?.data || result.reason.message;
            console.error(
              `Failed to ingest CompanyQA ID ${created[index].id}:`,
              errorMsg
            );
            return {
              status: "rejected",
              qa_id: created[index].id,
              error: errorMsg, // This is serializable
            };
          }
        });
        // --- END OF FIX ---
        
        console.log("Company QA ingestion triggers completed.");
      }
    }

    // This is now safe to send
    res.status(201).json({ message: "QAs created", created, aiData });

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
