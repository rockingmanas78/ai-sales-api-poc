import {
  configureCsvImportService,
  parseAndSeedCsvService,
  startCsvImportService,
  getCsvImportStatusService,
  createCsvImportJobService,
  getCsvImportJobStatusService,
  listCsvImportJobsService,
} from "../services/csvImport.service.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import csvParser from "csv-parser"; // optional if you want to parse CSV
import { Readable } from "stream";

// --- Initialize S3 client ---
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
    secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
  },
});

console.log(
  process.env.AWS_REGION,
  process.env.AWS_PROD_ACCESS_KEY,
  process.env.AWS_PROD_SECRET_KEY
);

// const BUCKET = process.env.S3_BUCKET || "sale-funnel-knowledge-documents";
const BUCKET = process.env.S3_BUCKET_CSV || "csv-bulk-leads";

// --- Utility to parse CSV from buffer (optional) ---
const parseCSV = async (buffer) => {
  return new Promise((resolve, reject) => {
    const results = [];
    Readable.from(buffer)
      .pipe(csvParser())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
};

// --- Main Controller ---
export const uploadCSVDocument = async (req, res) => {
  try {
    // 1️⃣ Validate file
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (req.file.mimetype !== "text/csv") {
      return res.status(400).json({ error: "Only CSV files are allowed" });
    }

    console.log("started");

    // 2️⃣ Upload to S3
    const file = req.file;
    const ext = path.extname(file.originalname);
    const fileKey = `csv/${uuidv4()}${ext}`;

    const uploadParams = {
      Bucket: BUCKET,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    console.log("Uploading to S3:", uploadParams);

    await s3.send(new PutObjectCommand(uploadParams));
    console.log("Uploaded to S3:", uploadParams);

    // 3️⃣ (Optional) Parse CSV for validation or preview
    // const parsedData = await parseCSV(file.buffer);

    // 4️⃣ Respond with metadata
    return res.status(200).json({
      message: "CSV uploaded successfully",
      fileKey,
      s3Url: `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`,
      // parsedData, // include this if you want parsed content
    });
  } catch (error) {
    console.error("Error uploading CSV document:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Configure a CSV Import Job.
 */
export const configureCsvImport = async (req, res) => {
  const {
    jobId,
    delimiter,
    headerRow,
    columnMapping,
    importMode,
    dedupePolicy,
  } = req.body;

  if (!jobId || !columnMapping) {
    return res
      .status(400)
      .json({ error: "jobId and columnMapping are required" });
  }

  try {
    const result = await configureCsvImportService({
      jobId,
      delimiter,
      headerRow,
      columnMapping,
      importMode,
      dedupePolicy,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("Error configuring CSV import job:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Parse and seed rows for a CSV Import Job.
 */
export const parseCsvImport = async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  try {
    const result = await parseAndSeedCsvService(jobId);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error parsing CSV import:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Start processing a CSV Import Job.
 */
export const startCsvImport = async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  try {
    const result = await startCsvImportService(jobId);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error starting CSV import job:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get the status of a CSV Import Job.
 */
export const getCsvImportStatus = async (req, res) => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  try {
    const result = await getCsvImportStatusService(jobId);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching CSV import job status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Create a new CSV Import Job.
 */
export const createCsvImportJob = async (req, res) => {
  const {
    tenantId,
    objectKey,
    columnMapping,
    importMode = "UPSERT",
    dedupePolicy = "EMAIL",
    delimiter,
    headerRow = 1,
    fileName,
  } = req.body;

  // console.log(req.body);
  if (!tenantId || !objectKey || !columnMapping) {
    return res.status(400).json({
      error: "tenantId, objectKey, and columnMapping are required",
    });
  }

  try {
    const result = await createCsvImportJobService({
      tenantId,
      objectKey,
      columnMapping,
      importMode,
      dedupePolicy,
      delimiter,
      headerRow,
      fileName,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error("Error creating CSV import job:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get the status of a specific CSV Import Job.
 */
export const getCsvImportJobStatus = async (req, res) => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  try {
    const result = await getCsvImportJobStatusService(jobId);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching CSV import job status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * List all CSV Import Jobs.
 */
export const listCsvImportJobs = async (req, res) => {
  const { tenantId, status, limit, cursor } = req.query;

  try {
    const result = await listCsvImportJobsService({
      tenantId,
      status,
      limit,
      cursor,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("Error listing CSV import jobs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
