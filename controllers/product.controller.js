import axios from "axios";
import { ingestProduct, ingestProductQa } from "../services/ai.service.js";
import prisma from "../utils/prisma.client.js";

export const getAllProducts = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { page = 1, limit = 10, search = "" } = req.query;

    const company = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!company) return res.status(404).json({ message: "Company not found. First register your company profile." });

    const products = await prisma.product.findMany({
      where: {
        company_id: company.id,
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      skip: (page - 1) * limit,
      take: parseInt(limit),
      orderBy: { created_at: "desc" },
      include: { ProductQA: true },
    });

    res.json(products);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { ProductQA: true },
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

 /**
 * THIS IS A SERVICE FUNCTION, NOT A CONTROLLER.
 * @param {string} productId - The ID of the parent product.
 * @param {Array} qaList - The array of { question, answer } objects.
 * @param {object} authHeader - The `req.headers` object from the controller.
 */
const bulkCreateQA = async (productId, qaList, authHeader) => {
  try {
    if (!Array.isArray(qaList) || qaList.length === 0) {
      return { message: "No QAs provided." };
    }

    // --- Duplicate Prevention ---
    const existingQAs = await prisma.productQA.findMany({
      where: { product_id: productId },
      select: { question: true },
    });
    const existingQuestions = new Set(
      existingQAs.map((q) => `${q.question}`.trim().toLowerCase())
    );

    const seen = new Set();
    const uniqueNewQAs = [];
    for (const qa of qaList) {
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

    if (newQAs.length === 0) {
      return {
        message: "All QAs provided already exist or were duplicates.",
        created: [],
        count: 0,
      };
    }

    // --- Create in Transaction ---
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
    let aiData = []; // Default to empty array

    if (created.length > 0 && authHeader?.authorization) {
      console.log(`Triggering ingestion for ${created.length} new Product QAs...`);

      const ingestPromises = created.map((qa) =>
        // Pass the authHeader (which is req.headers)
        ingestProductQa(qa.id, authHeader)
      );

      const results = await Promise.allSettled(ingestPromises);

      // --- FIX 1: Process results to be serializable ---
      aiData = results.map((result, index) => {
        if (result.status === "fulfilled") {
          return {
            status: "fulfilled",
            qa_id: created[index].id,
            data: result.value.data, // This is serializable
          };
        } else {
          const errorMsg =
            result.reason?.response?.data || result.reason.message;
          console.error(
            `Failed to ingest ProductQA ID ${created[index].id}:`,
            errorMsg
          );
          return {
            status: "rejected",
            qa_id: created[index].id,
            error: errorMsg, // This is serializable
          };
        }
      });
      console.log("Product QA ingestion triggers completed.");
    } else if (created.length > 0) {
      console.warn(
        "No auth header provided to bulkCreateQA; skipping ingestion."
      );
    }

    // --- Return serializable result object ---
    return {
      message: "QAs created successfully",
      created,
      count: created.length,
      aiData: aiData,
    };
  } catch (err) {
    console.error("Error bulk creating Product QAs:", err);
    // --- FIX 2: Throw the error, don't use `res` ---
    throw err;
  }
};

export const createProduct = async (req, res) => {
  const tenantId = req.user?.tenantId;
  // --- FIX 3: Separate ProductQA from the rest of the body ---
  const { name, ProductQA, ...rest } = req.body;

  if (!tenantId) {
    return res
      .status(400)
      .json({ message: "Missing tenant ID in user context" });
  }
  if (!name) {
    return res.status(400).json({ message: "Name is required" });
  }

  let company;
  try {
    company = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
    });
  } catch (dbErr) {
    console.error("Prisma error finding company:", dbErr);
    return res
      .status(500)
      .json({
        message: "Error searching for company profile",
        error: dbErr.message,
      });
  }

  if (!company) {
    return res.status(404).json({ message: "Company not found" });
  }

  // --- FIX 4: Create product data *without* QAs ---
  let data = {
    company_id: company.id,
    name,
    ...rest,
  };

  let newProduct;
  try {
    // This now *only* creates the product
    newProduct = await prisma.product.create({ data });
  } catch (dbErr) {
    if (dbErr.code === "P2002") {
      return res
        .status(409)
        .json({
          message: "Product with this name already exists",
          error: dbErr.meta,
        });
    }
    console.error("Prisma error creating product:", dbErr);
    return res
      .status(500)
      .json({ message: "Error creating product", error: dbErr.message });
  }

  // --- FIX 5: Call QA service *after* product is created ---
  let bulkCreateQAResult = null;
  if (ProductQA && Array.isArray(ProductQA) && ProductQA.length > 0) {
    try {
      // Pass the new product's ID, the QA list, and the headers
      bulkCreateQAResult = await bulkCreateQA(
        newProduct.id,
        ProductQA,
        req.headers
      );
    } catch (qaErr) {
      // If QA creation fails, we still created the product.
      // Return a 502 to indicate partial failure.
      console.error("Error in bulkCreateQA service call:", qaErr);
      return res.status(502).json({
        message: "Product created, but failed to create/ingest QAs",
        error: qaErr.message,
        record: newProduct,
      });
    }
  }

  let productIngestResponse;
  try {
    // Ingest the product *itself*
    productIngestResponse = await ingestProduct(newProduct.id, req.headers);
  } catch (aiErr) {
    console.error("AI ingestion error:", aiErr);
    return res.status(502).json({
      message: "Product created but ingestion failed",
      error: aiErr.message,
      record: newProduct,
      bulkCreateQAResult: bulkCreateQAResult, // Still return QA results if they succeeded
    });
  }

  // Success!
  return res.status(201).json({
    message: "Product and QAs processed successfully",
    newProduct,
    aiData: productIngestResponse.data, // Serialized data from product ingest
    bulkCreateQAResult: bulkCreateQAResult, // Full result from QA service
  });
};


export const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const updateData = req.body;

    console.log("Update data received:", updateData);

    const existing = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!existing)
      return res.status(400).json({ message: "Product not found" });

    const updated = await prisma.product.update({
      where: { id: productId },
      data,
    });

    res.json(updated);
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const existing = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!existing)
      return res.status(400).json({ message: "Product not found" });

    // Soft delete logic: mark as deleted (if needed) or hard delete
    await prisma.product.delete({
      where: { id: productId },
    });

    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
