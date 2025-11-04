import prisma from "../utils/prisma.client.js";
import axios from "axios";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import AWS from "aws-sdk";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import { ingestKnowledgeDocument } from "../services/ai.service.js";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  // add more allowed mimetypes if needed
];


const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
    secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
  },
});


export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const mimetype = req.file.mimetype;
    if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
      return res.status(400).json({
        error: `Unsupported file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
      });
    }

    const file = req.file;
    const ext = path.extname(file.originalname);
    const fileKey = `documents/${uuidv4()}${ext}`;

    const BUCKET = process.env.S3_BUCKET_DOCS || "sale-funnel-knowledge-documents";
    const REGION = process.env.AWS_REGION || "us-east-1";

    const uploadParams = {
      Bucket: BUCKET,
      Key: fileKey,
      Body: file.buffer,
      ContentType: mimetype,
    };

    // S3 Upload error handling
    try {
      await s3.send(new PutObjectCommand(uploadParams));
    } catch (s3Error) {
      console.error("S3 upload error:", s3Error);
      return res.status(502).json({ error: "Error uploading document to S3", details: s3Error.message });
    }

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "Missing tenant ID in user context" });
    }

    // Prisma DB error handling
    let doc;
    try {
      doc = await prisma.knowledgeDocument.create({
        data: {
          tenant_id: tenantId,
          file_key: fileKey,
          filename: file.originalname,
          mime_type: mimetype,
          size_bytes: file.size,
        },
      });
    } catch (dbError) {
      console.error("Prisma DB error:", dbError);
      return res.status(500).json({ error: "Error recording document metadata", details: dbError.message });
    }

    // AI ingest error handling
    let resp;
    try {
      resp = await ingestKnowledgeDocument(doc.id, req.headers);
      console.log(resp);
    } catch (aiError) {
      console.error("AI Service error:", aiError);
      // Optionally update doc status in DB to "ingest" failed here
      return res.status(500).json({ error: "Error ingesting document with AI", details: aiError.message });
    }

    return res.status(200).json({
      message: "Document uploaded and recorded successfully",
      fileKey,
      s3Url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/${fileKey}`,
      documentRecord: doc,
      aiIngest: resp,
    });
  } catch (error) {
    console.error("Error uploading or recording document:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
};


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
// export const getObjectStream = async (objectKey) => {
//   try {
//     if (objectKey.startsWith("http://") || objectKey.startsWith("https://")) {
//       // Fetch the file from a URL (e.g., Cloudinary)
//       const response = await axios.get(objectKey, {
//         responseType: "arraybuffer", // Ensure we get raw binary
//       });

//       console.log(response);

//       const buffer = Buffer.from(response.data); // Convert to Node buffer
//       console.log(buffer);
//       return Readable.from(buffer); // Turn buffer into a readable stream
//     } else {
//       // Fetch the file from S3
//       const params = {
//         Bucket: process.env.S3_BUCKET_CSV, // Ensure this environment variable is set
//         Key: objectKey,
//       };

//       return s3.getObject(params).createReadStream(); // Return S3 object as a readable stream
//     }
//   } catch (error) {
//     console.error("Error retrieving object stream:", error.message);
//     throw new Error(
//       "Failed to retrieve object stream. Please check the file format and try again."
//     );
//   }
// };

export const getObjectStream = async (objectKey) => {
  try {
    const params = {
      Bucket: process.env.S3_BUCKET_CSV, // Ensure this environment variable is set
      Key: objectKey,
    };
    console.log(params);
    const response = await s3.send(new GetObjectCommand(params));
    return response.Body; // This is a Readable stream
  } catch (error) {
    console.error("Error retrieving object stream:", error);
    throw error;
  }
};
