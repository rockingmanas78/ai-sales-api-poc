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
  try {
    const tenantId = req.user.tenantId;
    const { name, ...rest } = req.body;

    if (!name) return res.status(400).json({ message: "Name is required" });

    const company = await prisma.companyProfile.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!company) return res.status(404).json({ message: "Company not found" });

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
    const newProduct = await prisma.product.create({
      data,
    });

    res.status(201).json(newProduct);
  } catch (err) {
    console.error("Error creating product:", err);
    res.status(500).json({ message: "Internal server error" });
  }
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
