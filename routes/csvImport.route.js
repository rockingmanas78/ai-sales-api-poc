import express from "express";
import {
  configureCsvImport,
  parseCsvImport,
  startCsvImport,
  createCsvImportJob,
  getCsvImportJobStatus,
  listCsvImportJobs,
} from "../controllers/csvImport.controller.js";

const router = express.Router();

// Configure CSV Import Job
router.post("/configure", configureCsvImport);

// Parse and Seed Rows for CSV Import
router.post("/parse", parseCsvImport);

// Start Processing CSV Import Job
router.post("/start", startCsvImport);

// Create a new CSV Import Job
router.post("/", createCsvImportJob);

// Get the status of a specific CSV Import Job
router.get("/:jobId", getCsvImportJobStatus);

// List all CSV Import Jobs
router.get("/", listCsvImportJobs);

// Get the status of a specific CSV Import Job
router.get("/csv/:jobId", getCsvImportJobStatus);

export default router;
