import prisma from "../utils/prisma.client.js";
import axios from "axios";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import AWS from "aws-sdk";

const s3 = new AWS.S3();

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
    return res
      .status(400)
      .json({ message: "Missing tenant ID in user context" });
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
    orderBy: { created_at: "desc" },
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
    return res
      .status(404)
      .json({ message: "Document not found or access denied" });
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
      return res
        .status(404)
        .json({ message: "Document not found or access denied" });
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id },
      data: req.body,
    });

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ message: "Update failed", error: error.message });
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
      return res
        .status(404)
        .json({ message: "Document not found or access denied" });
    }

    const deleted = await prisma.knowledgeDocument.update({
      where: { id },
      data: { status: "DELETED" },
    });

    res.status(200).json({ message: "Document deleted successfully", deleted });
  } catch (error) {
    res.status(500).json({ message: "Delete failed", error: error.message });
  }
};

/**
 * Retrieves a file stream from a given URL or S3 object key.
 * @param {string} objectKey - The URL or S3 object key of the file.
 * @returns {ReadableStream} - The file stream.
 */
export const getObjectStream = async (objectKey) => {
  try {
    if (objectKey.startsWith("http://") || objectKey.startsWith("https://")) {
      // Fetch the file from a URL (e.g., Cloudinary)
      const response = await axios.get(objectKey, {
        responseType: "arraybuffer", // Ensure we get raw binary
      });

      const buffer = Buffer.from(response.data); // Convert to Node buffer
      return Readable.from(buffer); // Turn buffer into a readable stream
    } else {
      // Fetch the file from S3
      const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME, // Ensure this environment variable is set
        Key: objectKey,
      };

      return s3.getObject(params).createReadStream(); // Return S3 object as a readable stream
    }
  } catch (error) {
    console.error("Error retrieving object stream:", error.message);
    throw new Error(
      "Failed to retrieve object stream. Please check the file format and try again."
    );
  }
};
