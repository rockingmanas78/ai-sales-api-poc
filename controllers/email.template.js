import { PrismaClient } from '@prisma/client';
import { ALLOWED_VARS } from '../constants/template.constants.js';
const prisma = new PrismaClient();


// Create a new email template
// export const createTemplate = async (req, res) => {
  
//   try {
//     const { tenantId, name, subject, body, from, to, variable } = req.body;

//     if (!tenantId || !name || !subject || !body || !from || !to) {
//       return res.status(400).json({ message: "Required fields missing" });
//     }

//     // Validate tenantId exists and is not soft-deleted
//     const tenantExists = await prisma.tenant.findFirst({
//       where: {
//         id: tenantId,
//         deletedAt: null,
//       },
//     });

//     if (!tenantExists) {
//       return res.status(404).json({ error: "Tenant not found" });
//     }

//     const newTemplate = await prisma.emailTemplate.create({
//       data: {
//         tenantId,
//         name,
//         subject,
//         body,
//         from,
//         to,
//         variable: variable
//           ? {
//               create: variable.map(v => ({
//                 key: v.key,
//                 defaultValue: v.defaultValue,
//               })),
//             }
//           : undefined,
//       },
//       include: { variable: true },
//     });

//     res.status(201).json(newTemplate);
//   } catch (error) {
//     console.error("Error creating template:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// };
export const createTemplate = async (req, res) => {
  try {
    const { tenantId, name, subject, body, from, to, variable } = req.body;

    // 1️⃣ Required‐fields check
    if (!tenantId || !name || !subject || !body || !from || !to) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    // 2️⃣ Tenant existence check
    const tenantExists = await prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null }
    });
    if (!tenantExists) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // 3️⃣ Validate variable keys, if provided
    if (variable) {
      const keys = variable.map(v => v.key);
      const invalid = keys.filter(k => !ALLOWED_VARS.has(k));
      if (invalid.length) {
        return res.status(400).json({
          error: "Unsupported template variables",
          detail: {
            allowed: [...ALLOWED_VARS],
            invalid
          }
        });
      }
    }

    // 4️⃣ Create the template
    const newTemplate = await prisma.emailTemplate.create({
      data: {
        tenantId,
        name,
        subject,
        body,
        from,
        to,
        variable: variable
          ? {
              create: variable.map(v => ({
                key         : v.key,
                defaultValue: v.defaultValue
              }))
            }
          : undefined
      },
      include: { variable: true }
    });

    return res.status(201).json(newTemplate);
  } catch (error) {
    console.error("Error creating template:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Get all templates for a tenant (tenantId from req.body)
export const getTenantTemplates = async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required in body" });
    }

    const templates = await prisma.emailTemplate.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
      include: { variable: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get single template by ID with tenant validation (tenantId from req.body)
export const getTemplateById = async (req, res) => {
  try {
    const { templateId } = req.params;
    const  tenantId  = req.query.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required in query." });
    }

    const template = await prisma.emailTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
      include: { variable: true },
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found or access denied" });
    }

    res.json(template);
  } catch (error) {
    console.error("Error fetching template:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update template with tenant validation (tenantId from req.body)
export const updateTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const { tenantId, name, subject, body, from, to, variable } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required in body" });
    }

    const existingTemplate = await prisma.emailTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: "Template not found or access denied" });
    }

    await prisma.emailTemplate.update({
      where: { id: templateId },
      data: { name, subject, body, from, to },
    });

    if (Array.isArray(variable)) {
      await prisma.variable.deleteMany({ where: { templateId } });
      if (variable.length > 0) {
        await prisma.variable.createMany({
          data: variable.map(v => ({
            key: v.key,
            defaultValue: v.defaultValue,
            templateId,
          })),
        });
      }
    }

    const updatedTemplate = await prisma.emailTemplate.findUnique({
      where: { id: templateId },
      include: { variable: true },
    });

    res.json(updatedTemplate);
  } catch (error) {
    console.error("Error updating template:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Soft delete template with tenant validation (tenantId from req.body)
export const deleteTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const  tenantId  = req.query.tenantId;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required in query." });
    }

    const existingTemplate = await prisma.emailTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: "Template not found or access denied" });
    }

    await prisma.emailTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date() },
    });

    res.json({ message: "Template soft deleted successfully" });
  } catch (error) {
    console.error("Error soft deleting template:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
