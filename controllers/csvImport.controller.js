import {
  configureCsvImportService,
  parseAndSeedCsvService,
  startCsvImportService,
  getCsvImportStatusService,
  createCsvImportJobService,
  getCsvImportJobStatusService,
  listCsvImportJobsService,
} from "../services/csvImport.service.js";

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
  } = req.body;

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
