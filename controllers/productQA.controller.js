import prisma from '../utils/prisma.client.js'

// GET all QA for a product
export const getAllQA = async (req, res) => {
  const { productId } = req.params
  const qaList = await prisma.productQA.findMany({
    where: { product_id: productId },
  })
  res.json(qaList)
}

// GET one QA
export const getOneQA = async (req, res) => {
  const { qaId } = req.params
  const qa = await prisma.productQA.findUnique({
    where: { id: qaId },
  })
  if (!qa) return res.status(404).json({ error: 'QA not found' })
  res.json(qa)
}

export const bulkCreateQA = async (req, res) => {
  try {
    const { productId } = req.params;
    const qaList = req.body; // Expect array of { question, answer }

    if (!Array.isArray(qaList) || qaList.length === 0) {
      return res.status(400).json({ message: "Expected non-empty array of QA" });
    }

    // --- Duplicate Prevention ---
    // 1. Fetch existing questions for this product
    const existingQAs = await prisma.productQA.findMany({
      where: { product_id: productId },
      select: { question: true },
    });
    const existingQuestions = new Set(
      existingQAs.map((q) => `${q.question}`.trim().toLowerCase())
    );

    // 2. Filter duplicates from the input list (internal)
    const seen = new Set();
    const uniqueNewQAs = [];
    for (const qa of qaList) {
      if (!qa.question) continue; // Skip empty
      const key = `${qa.question}`.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueNewQAs.push(qa);
      }
    }

    // 3. Filter against what's already in the DB
    const newQAs = uniqueNewQAs.filter((qa) => {
      const key = `${qa.question}`.trim().toLowerCase();
      return !existingQuestions.has(key);
    });

    if (newQAs.length === 0) {
      return res.status(200).json({
        message: "All QAs provided already exist or were duplicates.",
        created: [],
        count: 0,
      });
    }

    // --- Create in Transaction (to get back IDs) ---
    // We use $transaction instead of createMany to get the created objects back
    const created = await prisma.$transaction(
      newQAs.map((qa) =>
        prisma.productQA.create({
          data: {
            product_id: productId,
            question: qa.question,
            answer: qa.answer,
          },
        })
      )
    );

    // --- Trigger Ingestion ---

    console.log(`Triggering ingestion for ${created.length} new Product QAs...`);

    const ingestPromises = created.map((qa) =>
      ingestProductQa(qa.id, req.headers)
    );

    // Run in parallel and log any failures without stopping the response
    const results = await Promise.allSettled(ingestPromises);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(
          `Failed to ingest ProductQA ID ${created[index].id}:`,
          result.reason
        );
      }
    });
    console.log("Product QA ingestion triggers completed.");


    // --- Send Response ---
    res.status(201).json({
      message: "QAs created successfully",
      created, // Send the full created objects
      count: created.length,
    });

  } catch (err) {
    console.error("Error bulk creating Product QAs:", err);
    // Handle specific error for a non-existent product
    if (err.code === "P2003") { // Foreign key constraint failed
      return res.status(404).json({ message: "Product not found." });
    }
    res.status(500).json({ message: "Internal server error" });
  }
};

// PATCH one QA
export const updateQA = async (req, res) => {
  const { qaId } = req.params
  const updated = await prisma.productQA.update({
    where: { id: qaId },
    data: req.body,
  })
  res.json(updated)
}

// DELETE one QA
export const deleteQA = async (req, res) => {
  const { qaId } = req.params;
  try {
    await prisma.productQA.delete({ where: { id: qaId } });
    res.status(200).json({ message: 'QA deleted successfully' });
  } catch (error) {
    res.status(500).json('Failed to delete QA');
  }
};

