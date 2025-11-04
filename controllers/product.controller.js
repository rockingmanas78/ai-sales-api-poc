import { ingestProduct } from "../services/ai.service.js";
import prisma from "../utils/prisma.client.js";

export const getAllProducts = async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { page = 1, limit = 10, search = "" } = req.query;

    const company = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!company) return res.status(404).json({ message: "Company not found" });

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

export const createProduct = async (req, res) => {
  const tenantId = req.user?.tenantId;
  const { name, ...rest } = req.body;

  if (!tenantId) {
    return res.status(400).json({ message: "Missing tenant ID in user context" });
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
    return res.status(500).json({ message: "Error searching for company profile", error: dbErr.message });
  }

  if (!company) {
    return res.status(404).json({ message: "Company not found" });
  }

  let data = {
    company_id: company.id,
    name,
    ...rest,
  };
  if (rest.ProductQA) {
    // Remove product_id from each QA object
    const cleanQAs = rest.ProductQA.map(({ product_id, ...qa }) => qa);
    data.ProductQA = { create: cleanQAs };
  }

  let newProduct;
  try {
    newProduct = await prisma.product.create({ data });
  } catch (dbErr) {
    // Handle Prisma error codes, e.g. unique constraint violation
    if (dbErr.code === "P2002") {
      return res.status(409).json({ message: "Product with this name already exists", error: dbErr.meta });
    }
    console.error("Prisma error creating product:", dbErr);
    return res.status(500).json({ message: "Error creating product", error: dbErr.message });
  }

  try {
    await ingestProduct(newProduct.id, req.headers);
  } catch (aiErr) {
    console.error("AI ingestion error:", aiErr);
    return res.status(502).json({
      message: "Product created but ingestion failed",
      error: aiErr.message,
      record: newProduct,
    });
  }

  return res.status(201).json(newProduct);
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
