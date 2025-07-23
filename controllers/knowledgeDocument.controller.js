import prisma from '../utils/prisma.client.js';
import { v4 as uuidv4 } from 'uuid'; //to generate unique file keys

export const generatePresignedUrl = async (req, res) => {
  const { filename, mimeType } = req.body;

  const fileKey = `documents/${uuidv4()}-${filename}`;

  //generate a signed S3 URL here
  const uploadUrl = `https://your-bucket.s3.amazonaws.com/${fileKey}`;

  res.status(200).json({ uploadUrl, fileKey });
};

export const recordUploadedDocument = async (req, res) => {
  const { fileKey, filename, mimeType, sizeBytes } = req.body;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(400).json({ message: 'Missing tenant ID in user context' });
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      tenant_id: tenantId,
      file_key: fileKey,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
    },
  });

  res.status(201).json(doc);
};

export const listDocuments = async (req, res) => {
  const { status } = req.query;
  const tenantId = req.user?.tenantId;

  const whereClause = {
    tenant_id: tenantId,
    ...(status ? { status } : {}),
  };

  const documents = await prisma.knowledgeDocument.findMany({
    where: whereClause,
    orderBy: { created_at: 'desc' },
  });

  res.status(200).json(documents);
};

//Get one document with tenant check
export const getDocumentById = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, tenant_id: tenantId },
  });

  if (!doc) {
    return res.status(404).json({ message: 'Document not found or access denied' });
  }

  res.status(200).json(doc);
};

//Update with tenant check
export const updateDocument = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  try {
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Document not found or access denied' });
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
};

//Soft-delete with tenant check
export const softDeleteDocument = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user?.tenantId;

  try {
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Document not found or access denied' });
    }

    const deleted = await prisma.knowledgeDocument.update({
      where: { id },
      data: { status: 'DELETED' },
    });

    res.status(200).json({ message: 'Document deleted successfully', deleted });
  } catch (error) {
    res.status(500).json({ message: 'Delete failed', error: error.message });
  }
};
