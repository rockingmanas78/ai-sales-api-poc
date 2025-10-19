import prisma from "../utils/prisma.client.js";
import { parse } from "csv-parse";
import {
  normalizeEmail,
  normalizePhone,
  canonicalizeLinkedInUrl,
  deriveDomainPlusName,
} from "../utils/normalization.js";
import xlsx from "xlsx";
import { Readable } from "stream";
import { lead_source } from "@prisma/client";
import dotenv from "dotenv";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
dotenv.config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
    secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
  },
});


/**
 * Service to parse a CSV file and seed rows into the database.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const parseAndSeedCsvService = async ({
  jobId,
  objectKey,
  delimiter = ",",
  headerRow = 1,
  updateJobStatus = true,
}) => {
  try {
    console.log("Starting parseAndSeedCsvService for jobId:", jobId);
    const startTime = Date.now();

    // Fetch the job details if jobId is provided
    let job;
    if (jobId) {
      job = await prisma.csvImportJob.findUnique({
        where: { id: jobId },
      });

      if (!job || !job.objectKey) {
        throw new Error("CSV import job or objectKey not found");
      }

      objectKey = objectKey || job.objectKey;
      delimiter = job.delimiter || delimiter;
      headerRow = (job.headerRow || headerRow) + 1; // Skip the header row
    }

    // Fetch the CSV file stream from S3
    const stream = await getObjectStreamCSV(objectKey);

    // Validate the file content
    const chunks = [];
    for await (const chunk of stream) {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        // console.log(
        //   `Chunk received (type: ${typeof chunk}):`,
        //   chunk.toString().slice(0, 100)
        // ); // Log the first 100 characters of the chunk
        chunks.push(Buffer.from(chunk));
      } else {
        console.error(
          `Invalid chunk type detected: ${typeof chunk}. Skipping this chunk.`
        );
        continue; // Skip invalid chunks
      }
    }

    const buffer = Buffer.concat(chunks);
    // console.log(
    //   "Complete buffer content (first 500 chars):",
    //   buffer.toString().slice(0, 500)
    // );

    if (!isValidCsv(buffer)) {
      throw new Error(
        "Invalid file format. The uploaded file does not appear to be a valid CSV."
      );
    }

    // Convert buffer to a readable stream
    const bufferStream = Readable.from(buffer);

    // Recreate the stream for parsing
    const parser = bufferStream.pipe(
      parse({
        delimiter,
        from_line: headerRow,
      })
    );

    let totalRows = 0;

    // Use a transaction to ensure atomicity
    await prisma.$transaction(async (prisma) => {
      for await (const record of parser) {
        totalRows++;

        // Log each row being parsed
        // console.log(`Parsing row ${totalRows}:`, record);

        // Seed each row into the database
        await prisma.csvImportRow.create({
          data: {
            jobId,
            rowNumber: totalRows,
            rawData: record,
            status: "QUEUED",
          },
        });
      }

      if (updateJobStatus && jobId) {
        // Update the job with the total rows
        await prisma.csvImportJob.update({
          where: { id: jobId },
          data: { totalRows }, // Pass only the integer value of totalRows
        });
      }
    });

    const endTime = Date.now();
    console.log(
      `parseAndSeedCsvService completed for jobId: ${jobId} in ${
        endTime - startTime
      }ms with ${totalRows} rows.`
    );

    return { message: "CSV parsed and rows seeded successfully", totalRows };
  } catch (error) {
    console.error("Error in parseAndSeedCsvService:", error);
    throw error;
  }
};

const isValidCsv = (buffer) => {
  const text = buffer.toString("utf8", 0, 100); // Read the first 100 bytes as text
  return text.includes(",") || text.includes("\n"); // Basic check for CSV structure
};

const isValidXlsx = (buffer) => {
  const header = buffer.toString("utf8", 0, 4);
  return header === "PK\u0003\u0004"; // XLSX files start with this signature
};

const parseXlsx = (buffer) => {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet, { header: 1 }); // Convert to array of arrays
};

const isValidCsvOrXlsx = (buffer) => {
  return isValidCsv(buffer) || isValidXlsx(buffer);
};

/**
 * Service to configure a CSV Import Job.
 * @param {object} config - The configuration object.
 */
export const configureCsvImportService = async (config) => {
  const {
    jobId,
    delimiter,
    headerRow,
    columnMapping,
    importMode,
    dedupePolicy,
  } = config;

  try {
    // Update the CsvImportJob with configuration details
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { delimiter, headerRow, columnMapping, importMode, dedupePolicy },
    });

    return { message: "CSV import job configured successfully" };
  } catch (error) {
    console.error("Error in configureCsvImportService:", error);
    throw error;
  }
};

/**
 * Service to start processing a CSV Import Job.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const startCsvImportService = async (jobId) => {
  try {
    // Update the job status to PROCESSING
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    return { message: "CSV import job started successfully" };
  } catch (error) {
    console.error("Error in startCsvImportService:", error);
    throw error;
  }
};

/**
 * Service to get the status of a CSV Import Job.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const getCsvImportStatusService = async (jobId) => {
  try {
    // Fetch the job details along with progress and recent rows
    const job = await prisma.csvImportJob.findUnique({
      where: { id: jobId },
      include: {
        rows: {
          orderBy: { rowNumber: "asc" },
          take: 10, // Fetch recent rows
        },
      },
    });

    if (!job) {
      throw new Error("CSV import job not found");
    }

    return job;
  } catch (error) {
    console.error("Error in getCsvImportStatusService:", error);
    throw error;
  }
};

/**
 * Create a new CSV Import Job.
 */
export const createCsvImportJobService = async ({
  tenantId,
  objectKey,
  columnMapping,
  importMode,
  dedupePolicy,
  delimiter,
  headerRow,
}) => {
  try {
    // Create the job in the database
    const job = await prisma.csvImportJob.create({
      data: {
        tenantId,
        objectKey,
        columnMapping,
        importMode,
        dedupePolicy,
        delimiter,
        headerRow,
        status: "QUEUED",
      },
    });

    // Stream the CSV and seed rows
    const totalRows = await parseAndSeedCsvService({
      objectKey,
      jobId: job.id,
      delimiter,
      headerRow,
      columnMapping,
    });

    // // Update the job with total rows
    // await prisma.csvImportJob.update({
    //   where: { id: job.id },
    //   data: { totalRows },
    // });

    return {
      jobId: job.id,
      tenantId: job.tenantId,
      status: job.status,
      totalRows,
      processedRows: 0,
      duplicateRows: 0,
      failedRows: 0,
      createdAt: job.createdAt,
    };
  } catch (error) {
    console.error("Error creating CSV import job:", error);
    throw error;
  }
};

/**
 * Get the status of a specific CSV Import Job.
 */
export const getCsvImportJobStatusService = async (jobId) => {
  try {
    const job = await prisma.csvImportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error("Job not found");
    }

    return {
      jobId: job.id,
      tenantId: job.tenantId,
      status: job.status,
      importMode: job.importMode,
      dedupePolicy: job.dedupePolicy,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      duplicateRows: job.duplicateRows,
      failedRows: job.failedRows,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  } catch (error) {
    console.error("Error fetching CSV import job status:", error);
    throw error;
  }
};

/**
 * List all CSV Import Jobs.
 */
export const listCsvImportJobsService = async ({
  tenantId,
  status,
  limit,
  cursor,
}) => {
  try {
    const where = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (status) {
      where.status = { in: status.split(",") };
    }

    const jobs = await prisma.csvImportJob.findMany({
      where,
      take: limit ? parseInt(limit, 10) : undefined,
      skip: cursor ? 1 : undefined,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
    });

    const nextCursor = jobs.length > 0 ? jobs[jobs.length - 1].id : null;

    return {
      items: jobs.map((job) => ({
        jobId: job.id,
        tenantId: job.tenantId,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        duplicateRows: job.duplicateRows,
        failedRows: job.failedRows,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      })),
      nextCursor,
    };
  } catch (error) {
    console.error("Error listing CSV import jobs:", error);
    throw error;
  }
};

// Function to validate row data
const validateRowData = (row, rawData) => {
  const errors = [];

  // Validate the structure of the row
  if (!Array.isArray(rawData) || rawData.length !== 6) {
    errors.push("Row does not have the required 6 fields.");
    return errors;
  }

  // Validate each field in the specified order
  const [
    companyName,
    contactName,
    contactEmail,
    contactPhone,
    linkedInUrl,
    companySize,
  ] = rawData;

  // Check if companyName is a valid string
  if (typeof companyName !== "string" || companyName.trim() === "") {
    errors.push("Invalid company name.");
  }

  // Check if contactName is a valid string and does not contain numbers
  if (typeof contactName !== "string" || /\d/.test(contactName)) {
    errors.push("Contact name contains invalid characters or numbers.");
  }

  // Check if contactEmail contains '@'
  if (typeof contactEmail !== "string" || !contactEmail.includes("@")) {
    errors.push("Invalid email format.");
  }

  // Check if contactPhone is a valid string (basic validation for phone number)
  if (typeof contactPhone !== "string" || !/^[\d\-\+\s]+$/.test(contactPhone)) {
    errors.push("Invalid phone number format.");
  }

  // Check if linkedInUrl is a valid URL
  if (
    typeof linkedInUrl !== "string" ||
    !linkedInUrl.startsWith("https://linkedin.com/")
  ) {
    errors.push("Invalid LinkedIn URL.");
  }

  // Check if companySize is a valid number
  if (isNaN(parseInt(companySize, 10))) {
    errors.push("Invalid company size.");
  }

  return errors;
};

/**
 * Process a CSV Import Job in batches.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const processCsvImportJob = async (jobId) => {
  try {
    const batchSize = 5;

    // Fetch job details
    const job = await fetchJobDetails(jobId);
    if (!job) return;

    // Fetch job counters
    const { processedRows, duplicateRows, failedRows } = await fetchJobCounters(
      jobId
    );

    // Fetch a batch of QUEUED rows
    const rows = await fetchQueuedRows(jobId, batchSize);

    if (rows.length === 0) {
      // Mark job as COMPLETED if no QUEUED rows remain
      await prisma.csvImportJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      console.log(`Job ${jobId} marked as COMPLETED. No more QUEUED rows.`);
      return;
    }

    let processedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      try {
        const result = await processRow(
          row,
          job,
          job.dedupePolicy,
          job.importMode
        );
        if (result.status === "PROCESSED") processedCount++;
        else if (result.status === "DUPLICATE") duplicateCount++;
        else if (result.status === "FAILED") failedCount++;
      } catch (error) {
        failedCount++;
        console.error(`Error processing row ${row.rowNumber}:`, error.message);
        console.error(`Raw Data: ${JSON.stringify(row.rawData)}`);
        console.error(`Stack Trace:`, error.stack);
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: { status: "FAILED", processedAt: new Date() },
        });
      }
    }

    // Update job counters
    await updateJobCounters(jobId, processedCount, duplicateCount, failedCount);

    console.log(`Job ${jobId}: Processed ${rows.length} rows.`);

    // Requeue the job for further processing
    setImmediate(() => processCsvImportJob(jobId));
  } catch (error) {
    console.error("Error in processCsvImportJob:", error.message);
    console.error("Stack Trace:", error.stack);
    throw error;
  }
};

// Helper function to fetch job details and validate status
const fetchJobDetails = async (jobId) => {
  const job = await prisma.csvImportJob.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status !== "PROCESSING") {
    if (job.status === "QUEUED") {
      if (job.retryCount >= parseInt(process.env.RETRY_COUNT_MAX_LIMIT, 5)) {
        await prisma.csvImportJob.update({
          where: { id: jobId },
          data: { status: "FAILED", completedAt: new Date() },
        });
        console.log(`Job ${jobId} marked as FAILED due to retry limit.`);
        return null;
      }

      await prisma.csvImportJob.update({
        where: { id: jobId },
        data: { retryCount: job.retryCount + 1, status: "QUEUED" },
      });
      console.log(
        `Job ${jobId} re-queued with retry count ${job.retryCount + 1}.`
      );
      return null;
    } else {
      return null; // Skip jobs that are not PROCESSING or QUEUED
    }
  }

  return job;
};

// Helper function to fetch job counters
const fetchJobCounters = async (jobId) => {
  const jobCounters = await prisma.csvImportJob.findUnique({
    where: { id: jobId },
    select: {
      processedRows: true,
      duplicateRows: true,
      failedRows: true,
    },
  });

  return {
    processedRows: jobCounters?.processedRows || 0,
    duplicateRows: jobCounters?.duplicateRows || 0,
    failedRows: jobCounters?.failedRows || 0,
  };
};

// Helper function to fetch queued rows
const fetchQueuedRows = async (jobId, batchSize) => {
  return await prisma.csvImportRow.findMany({
    where: { jobId, status: "QUEUED" },
    orderBy: { rowNumber: "asc" },
    take: batchSize,
  });
};

// Helper function to process a single row
const processRow = async (row, job, dedupePolicy, importMode) => {
  const rawData = row.rawData;

  // Validate row data
  const validationErrors = validateRowData(row, rawData);
  if (validationErrors.length > 0) {
    await prisma.csvImportRow.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        processedAt: new Date(),
        error: validationErrors.join("; "),
      },
    });
    return { status: "FAILED" };
  }

  // Map rawData to fields
  const [
    companyName,
    contactName,
    contactEmail,
    contactPhone,
    linkedInUrl,
    companySize,
  ] = rawData;
  const mappedFields = {
    companyName,
    contactName,
    contactEmail,
    contactPhone,
    linkedInUrl,
    companySize: parseInt(companySize, 10),
    tenantId: job.tenantId,
  };

  // Normalize fields
  const email = normalizeEmail(mappedFields.contactEmail);
  const phone = normalizePhone(mappedFields.contactPhone);
  const domainPlusName = deriveDomainPlusName(email, mappedFields.companyName);
  const normalizedLinkedInUrl = canonicalizeLinkedInUrl(
    mappedFields.linkedInUrl
  );

  // Ensure contactEmail is an array if required by Prisma schema
  const contactEmailArray = email ? [email] : [];

  // Deduplication logic
  let existingLead = null;
  if (dedupePolicy === "EMAIL" && email) {
    existingLead = await prisma.lead.findFirst({
      where: { tenantId: job.tenantId, contactEmail: { has: email } },
    });
  } else if (dedupePolicy === "PHONE" && phone) {
    existingLead = await prisma.lead.findFirst({
      where: { tenantId: job.tenantId, contactPhone: { has: phone } },
    });
  } else if (dedupePolicy === "DOMAIN_PLUS_NAME" && domainPlusName) {
    existingLead = await prisma.lead.findFirst({
      where: {
        tenantId: job.tenantId,
        contactEmail: { has: domainPlusName.domain },
        companyName: domainPlusName.name,
      },
    });
  } else if (dedupePolicy === "LINKEDIN_URL" && normalizedLinkedInUrl) {
    existingLead = await prisma.lead.findFirst({
      where: {
        tenantId: job.tenantId,
        linkedInUrl: normalizedLinkedInUrl,
      },
    });
  }

  // Apply importMode
  if (importMode === "DRY_RUN") {
    await prisma.csvImportRow.update({
      where: { id: row.id },
      data: { status: "SKIPPED", processedAt: new Date() },
    });
    return { status: "SKIPPED" };
  } else if (importMode === "INSERT_ONLY") {
    if (existingLead) {
      await prisma.csvImportRow.update({
        where: { id: row.id },
        data: { status: "DUPLICATE", processedAt: new Date() },
      });
      return { status: "DUPLICATE" };
    } else {
      try {
        const newLead = await prisma.lead.create({
          data: {
            tenantId: job.tenantId,
            companyName: mappedFields.companyName,
            contactName: mappedFields.contactName,
            contactEmail: contactEmailArray,
            contactPhone: phone ? [phone] : [],
            source: lead_source.CSV_UPLOAD,
            linkedInUrl: mappedFields.linkedInUrl,
            companySize: mappedFields.companySize,
          },
        });
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: {
            status: "PROCESSED",
            createdLeadId: newLead.id,
            processedAt: new Date(),
          },
        });
        return { status: "PROCESSED" };
      } catch (error) {
        if (error.code === "P2002") {
          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: { status: "DUPLICATE", processedAt: new Date() },
          });
          return { status: "DUPLICATE" };
        } else {
          throw error;
        }
      }
    }
  } else if (importMode === "UPSERT") {
    if (existingLead) {
      await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          companyName: mappedFields.companyName,
          contactName: mappedFields.contactName,
          contactEmail: contactEmailArray,
          contactPhone: phone ? [phone] : [],
          linkedInUrl: mappedFields.linkedInUrl,
          companySize: mappedFields.companySize,
        },
      });
      await prisma.csvImportRow.update({
        where: { id: row.id },
        data: {
          status: "PROCESSED",
          createdLeadId: existingLead.id,
          processedAt: new Date(),
        },
      });
      return { status: "PROCESSED" };
    } else {
      try {
        const newLead = await prisma.lead.create({
          data: {
            tenantId: job.tenantId,
            companyName: mappedFields.companyName,
            contactName: mappedFields.contactName,
            contactEmail: contactEmailArray,
            contactPhone: phone ? [phone] : [],
            source: lead_source.CSV_UPLOAD,
            linkedInUrl: mappedFields.linkedInUrl,
            companySize: mappedFields.companySize,
          },
        });
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: {
            status: "PROCESSED",
            createdLeadId: newLead.id,
            processedAt: new Date(),
          },
        });
        return { status: "PROCESSED" };
      } catch (error) {
        if (error.code === "P2002") {
          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: { status: "DUPLICATE", processedAt: new Date() },
          });
          return { status: "DUPLICATE" };
        } else {
          throw error;
        }
      }
    }
  }
};

// Helper function to update job counters
const updateJobCounters = async (
  jobId,
  processedCount,
  duplicateCount,
  failedCount
) => {
  await prisma.csvImportJob.update({
    where: { id: jobId },
    data: {
      processedRows: { increment: processedCount },
      duplicateRows: { increment: duplicateCount },
      failedRows: { increment: failedCount },
    },
  });
};

/**
 * Worker function to process all CSV import jobs with status QUEUED.
 */
export const processCsvJobs = async () => {
  try {
    // Fetch jobs with status QUEUED, limit to 200 rows total
    const jobs = await prisma.csvImportJob.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 5, // Limit the total number of rows to process
    });

    for (const job of jobs) {
      console.log(`Worker: Transitioning job ${job.id} to PROCESSING`);

      // Update job status to PROCESSING
      await prisma.csvImportJob.update({
        where: { id: job.id },
        data: { status: "PROCESSING", startedAt: new Date() },
      });

      console.log(`Worker: Processing job ${job.id}`);
      await processCsvImportJob(job.id);
    }
  } catch (error) {
    console.error("Worker: Error processing jobs:", error);
    throw error;
  }
};



export const getObjectStreamCSV = async (objectKey) => {
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
