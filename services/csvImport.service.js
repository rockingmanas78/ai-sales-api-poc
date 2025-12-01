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
  console.log(
    `[parseAndSeedCsvService] === START === JobId: ${jobId}, ObjectKey: ${objectKey}`
  );
  const startTime = Date.now();

  try {
    // Fetch the job details if jobId is provided
    let job;
    if (jobId) {
      try {
        job = await prisma.csvImportJob.findUnique({
          where: { id: jobId },
        });
        console.log(
          `[parseAndSeedCsvService] Job fetched successfully: ${jobId}`
        );
      } catch (dbError) {
        console.error(
          `[parseAndSeedCsvService] Database error fetching job ${jobId}:`,
          dbError
        );
        throw new Error(`Failed to fetch CSV import job: ${dbError.message}`);
      }

      if (!job) {
        console.error(
          `[parseAndSeedCsvService] CSV import job not found for jobId: ${jobId}`
        );
        throw new Error("CSV import job not found");
      }

      if (!job.objectKey && !objectKey) {
        console.error(
          `[parseAndSeedCsvService] objectKey not found for jobId: ${jobId}`
        );
        throw new Error("CSV import job or objectKey not found");
      }

      objectKey = objectKey || job.objectKey;
      delimiter = job.delimiter || delimiter;
      headerRow = job.headerRow || headerRow;

      console.log(
        `[parseAndSeedCsvService] Job config - delimiter: '${delimiter}', headerRow: ${headerRow}`
      );
    }

    // Fetch the CSV file stream from S3
    console.log(
      `[parseAndSeedCsvService] Fetching object from S3: ${objectKey}`
    );
    let stream;
    try {
      stream = await getObjectStreamCSV(objectKey);
      console.log(`[parseAndSeedCsvService] S3 stream retrieved successfully`);
    } catch (s3Error) {
      console.error(
        `[parseAndSeedCsvService] S3 fetch error for ${objectKey}:`,
        s3Error
      );
      throw new Error(`Failed to fetch file from S3: ${s3Error.message}`);
    }

    // Validate the file content
    console.log(`[parseAndSeedCsvService] Reading stream chunks...`);
    const chunks = [];
    try {
      for await (const chunk of stream) {
        if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
          chunks.push(Buffer.from(chunk));
        } else {
          console.warn(
            `[parseAndSeedCsvService] Invalid chunk type: ${typeof chunk}, skipping`
          );
          continue;
        }
      }
    } catch (streamError) {
      console.error(
        `[parseAndSeedCsvService] Stream reading error:`,
        streamError
      );
      throw new Error(`Failed to read file stream: ${streamError.message}`);
    }

    const buffer = Buffer.concat(chunks);
    console.log(
      `[parseAndSeedCsvService] Buffer created - Size: ${buffer.length} bytes`
    );

    if (!isValidCsv(buffer)) {
      console.error(
        `[parseAndSeedCsvService] Invalid CSV format for: ${objectKey}`
      );
      throw new Error(
        "Invalid file format. The uploaded file does not appear to be a valid CSV."
      );
    }
    console.log(`[parseAndSeedCsvService] CSV validation passed`);

    // Convert buffer to a readable stream
    const bufferStream = Readable.from(buffer);

    // Create parser with proper configuration
    const parser = bufferStream.pipe(
      parse({
        delimiter,
        from_line: headerRow,
        columns: true,
        skip_empty_lines: true,
        trim: true,
        // Allow records with fewer/more fields than the header without throwing
        relax_column_count: true,
      })
    );

    // Attach an error handler so parser errors don't crash the whole process.
    // We mark the CSV job FAILED and log the error so operators can inspect it.
    parser.on("error", async (err) => {
      console.error(
        `[parseAndSeedCsvService] CSV parser error for job ${jobId}:`,
        err
      );
      try {
        if (jobId) {
          await prisma.csvImportJob.update({
            where: { id: jobId },
            data: { status: "FAILED", completedAt: new Date() },
          });
          console.log(
            `[parseAndSeedCsvService] Marked job ${jobId} as FAILED due to parser error.`
          );
        }
      } catch (uErr) {
        console.error(
          `[parseAndSeedCsvService] Failed to mark job ${jobId} as FAILED:`,
          uErr
        );
      }
    });
    console.log(`[parseAndSeedCsvService] CSV parser initialized`);

    let totalRows = 0;

    // Use a transaction to ensure atomicity
    console.log(
      `[parseAndSeedCsvService] Starting DB transaction for job ${jobId}...`
    );
    try {
      await prisma.$transaction(async (prisma) => {
        for await (const record of parser) {
          totalRows++;

          // Log progress every 1000 rows
          if (totalRows % 1000 === 0) {
            console.log(
              `[parseAndSeedCsvService] Progress: ${totalRows} rows seeded for job ${jobId}`
            );
          }

          try {
            // Seed each row into the database
            await prisma.csvImportRow.create({
              data: {
                jobId,
                rowNumber: totalRows,
                rawData: record,
                status: "QUEUED",
              },
            });
          } catch (rowError) {
            console.error(
              `[parseAndSeedCsvService] Failed to create row ${totalRows} for job ${jobId}:`,
              rowError
            );
            throw rowError;
          }
        }

        console.log(
          `[parseAndSeedCsvService] Transaction complete - Total rows seeded: ${totalRows}`
        );

        if (updateJobStatus && jobId) {
          try {
            await prisma.csvImportJob.update({
              where: { id: jobId },
              data: { totalRows },
            });
            console.log(
              `[parseAndSeedCsvService] Job ${jobId} updated with totalRows: ${totalRows}`
            );
          } catch (updateError) {
            console.error(
              `[parseAndSeedCsvService] Failed to update job ${jobId}:`,
              updateError
            );
            throw updateError;
          }
        }
      });
    } catch (transactionError) {
      console.error(
        `[parseAndSeedCsvService] Transaction failed for job ${jobId}:`,
        transactionError
      );
      throw new Error(
        `Database transaction failed: ${transactionError.message}`
      );
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(
      `[parseAndSeedCsvService] === SUCCESS === JobId: ${jobId}, Rows: ${totalRows}, Duration: ${duration}ms`
    );

    return { message: "CSV parsed and rows seeded successfully", totalRows };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.error(
      `[parseAndSeedCsvService] === FAILED === JobId: ${jobId}, Duration: ${duration}ms`
    );
    console.error(`[parseAndSeedCsvService] Error details:`, error);
    throw error;
  }
};

const isValidCsv = (buffer) => {
  try {
    const text = buffer.toString("utf8", 0, 100);
    const isValid = text.includes(",") || text.includes("\n");
    console.log(`[isValidCsv] Validation result: ${isValid}`);
    return isValid;
  } catch (error) {
    console.error(`[isValidCsv] Error during validation:`, error);
    return false;
  }
};

const isValidXlsx = (buffer) => {
  try {
    const header = buffer.toString("utf8", 0, 4);
    return header === "PK\u0003\u0004";
  } catch (error) {
    console.error(`[isValidXlsx] Error during validation:`, error);
    return false;
  }
};

const parseXlsx = (buffer) => {
  try {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { header: 1 });
  } catch (error) {
    console.error(`[parseXlsx] Error parsing XLSX:`, error);
    throw error;
  }
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
  console.log(`[configureCsvImportService] === START === JobId: ${jobId}`);

  try {
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { delimiter, headerRow, columnMapping, importMode, dedupePolicy },
    });

    console.log(
      `[configureCsvImportService] === SUCCESS === Job ${jobId} configured`
    );
    return { message: "CSV import job configured successfully" };
  } catch (error) {
    console.error(
      `[configureCsvImportService] === FAILED === JobId: ${jobId}`,
      error
    );
    throw error;
  }
};

/**
 * Service to start processing a CSV Import Job.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const startCsvImportService = async (jobId) => {
  console.log(`[startCsvImportService] === START === JobId: ${jobId}`);

  try {
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    console.log(
      `[startCsvImportService] === SUCCESS === Job ${jobId} status: PROCESSING`
    );
    return { message: "CSV import job started successfully" };
  } catch (error) {
    console.error(
      `[startCsvImportService] === FAILED === JobId: ${jobId}`,
      error
    );
    throw error;
  }
};

/**
 * Service to get the status of a CSV Import Job.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const getCsvImportStatusService = async (jobId) => {
  console.log(`[getCsvImportStatusService] Fetching status for job: ${jobId}`);

  try {
    const job = await prisma.csvImportJob.findUnique({
      where: { id: jobId },
      include: {
        rows: {
          orderBy: { rowNumber: "asc" },
          take: 10,
        },
      },
    });

    if (!job) {
      console.error(`[getCsvImportStatusService] Job not found: ${jobId}`);
      throw new Error("CSV import job not found");
    }

    console.log(
      `[getCsvImportStatusService] Job ${jobId} status: ${job.status}`
    );
    return job;
  } catch (error) {
    console.error(
      `[getCsvImportStatusService] FAILED for job ${jobId}:`,
      error
    );
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
  fileName,
}) => {
  console.log(
    `[createCsvImportJobService] === START === Tenant: ${tenantId}, ObjectKey: ${objectKey}`
  );

  try {
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
        name: fileName,
      },
    });
    console.log(`[createCsvImportJobService] Job created: ${job.id}`);

    const { totalRows } = await parseAndSeedCsvService({
      objectKey,
      jobId: job.id,
      delimiter,
      headerRow,
      columnMapping,
    });

    console.log(
      `[createCsvImportJobService] === SUCCESS === Job ${job.id}, TotalRows: ${totalRows}`
    );

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
    console.error(
      `[createCsvImportJobService] === FAILED === Tenant: ${tenantId}`,
      error
    );
    throw error;
  }
};

/**
 * Get the status of a specific CSV Import Job.
 */
export const getCsvImportJobStatusService = async (jobId) => {
  console.log(
    `[getCsvImportJobStatusService] Fetching status for job: ${jobId}`
  );

  try {
    const job = await prisma.csvImportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      console.error(`[getCsvImportJobStatusService] Job not found: ${jobId}`);
      throw new Error("Job not found");
    }

    console.log(
      `[getCsvImportJobStatusService] Job ${jobId} found, status: ${job.status}`
    );
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
    console.error(
      `[getCsvImportJobStatusService] FAILED for job ${jobId}:`,
      error
    );
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
  console.log(
    `[listCsvImportJobsService] Listing jobs - Tenant: ${tenantId}, Status: ${status}`
  );

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
    console.log(`[listCsvImportJobsService] Found ${jobs.length} jobs`);

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
        name: job.name,
      })),
      nextCursor,
    };
  } catch (error) {
    console.error(`[listCsvImportJobsService] FAILED to list jobs:`, error);
    throw error;
  }
};

// Function to validate row data with shuffled headers and different names
const validateRowData = (row, rawData) => {
  const errors = [];
  console.log(`[validateRowData] Validating row ${row.rowNumber}`);

  try {
    if (
      typeof rawData !== "object" ||
      rawData === null ||
      Array.isArray(rawData)
    ) {
      const error = `Row ${row.rowNumber} has invalid data format. Expected an object.`;
      console.error(`[validateRowData] ${error}`);
      errors.push(error);
      return errors;
    }

    // Build header map from the object's keys (parser used columns:true)
    const headers = Object.keys(rawData || {});

    // Normalization helper: unicode-normalize, strip diacritics, remove non-alphanum
    const normalize = (s = "") => {
      try {
        const str = String(s || "");
        // decompose unicode (NFKD) and strip diacritic marks
        const decomposed = str.normalize
          ? str.normalize("NFKD").replace(/\p{M}/gu, "")
          : str;
        return decomposed.toLowerCase().replace(/[^a-z0-9]/g, "");
      } catch (e) {
        return String(s || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      }
    };

    const normalizedHeaderMap = {};
    headers.forEach((h) => {
      normalizedHeaderMap[normalize(h)] = h;
    });

    // Define required variants for flexible header matching
    const requiredVariants = {
      companyName: [
        "company",
        "companyname",
        "companyname",
        "organization",
        "org",
        "business",
        "businessname",
      ],
      contactEmail: ["email", "contactemail", "emailaddress", "companyemail"],
      contactName: [
        "contactname",
        "name",
        "fullname",
        "representative",
        "manager",
        "contactperson",
        "poc",
      ],
    };

    // Optional variants
    const optionalVariants = {
      contactPhone: ["phone", "contactphone", "phonenumber", "contact_number"],
      linkedInUrl: ["linkedin", "linkedinurl", "linkedin_url", "linked_in"],
      companySize: ["companysize", "size", "employees", "company_size"],
    };

    const columnMapping = {};
    const missingRequired = [];

    // Try to map required fields with multiple fallback strategies
    for (const field of Object.keys(requiredVariants)) {
      const variants = requiredVariants[field];
      let mapped = null;

      // 1) Exact variant match
      for (const v of variants) {
        const n = normalize(v);
        if (normalizedHeaderMap[n]) {
          mapped = normalizedHeaderMap[n];
          break;
        }
      }

      // 2) Exact field name match
      if (!mapped && normalizedHeaderMap[normalize(field)]) {
        mapped = normalizedHeaderMap[normalize(field)];
      }

      // 3) Substring / token match: find any header that contains variant tokens
      if (!mapped) {
        for (const h of headers) {
          const nh = normalize(h);
          for (const v of variants) {
            const nv = normalize(v);
            if (nh.includes(nv) || nv.includes(nh)) {
              mapped = h;
              break;
            }
            // token intersection: split by non-alpha and test any token overlap
            const hTokens = nh.split(/[^a-z0-9]+/).filter(Boolean);
            const vTokens = nv.split(/[^a-z0-9]+/).filter(Boolean);
            if (hTokens.some((t) => vTokens.includes(t))) {
              mapped = h;
              break;
            }
          }
          if (mapped) break;
        }
      }

      if (mapped) {
        columnMapping[field] = mapped;
        console.log(
          `[validateRowData] Mapped field '${field}' -> header '${mapped}'`
        );
      } else {
        missingRequired.push(field);
      }
    }

    // Map optional fields if present
    for (const field of Object.keys(optionalVariants)) {
      const variants = optionalVariants[field];
      for (const v of variants) {
        const n = normalize(v);
        if (normalizedHeaderMap[n]) {
          columnMapping[field] = normalizedHeaderMap[n];
          break;
        }
      }
    }

    // If required mapping couldn't be established, return a helpful error containing suggested mapping
    if (missingRequired.length > 0) {
      const msg = `Row ${
        row.rowNumber
      }: Missing required columns: ${missingRequired.join(", ")}`;
      console.warn(
        `[validateRowData] ${msg}. Suggested mapping: ${JSON.stringify(
          columnMapping
        )}`
      );
      errors.push(
        msg + `. Suggested mapping: ${JSON.stringify(columnMapping)}`
      );
      return errors;
    }

    // Now read values using the mapped headers so order/shuffle doesn't matter
    const companyName = rawData[columnMapping.companyName];
    const contactEmail = rawData[columnMapping.contactEmail];
    const contactName = rawData[columnMapping.contactName];
    const contactPhone = columnMapping.contactPhone
      ? rawData[columnMapping.contactPhone]
      : rawData.contactPhone;
    const linkedInUrl = columnMapping.linkedInUrl
      ? rawData[columnMapping.linkedInUrl]
      : rawData.linkedInUrl;
    const companySize = columnMapping.companySize
      ? rawData[columnMapping.companySize]
      : rawData.companySize;

    // Perform existing validations on the mapped values

    // Validate companyName
    if (typeof companyName !== "string" || companyName.trim() === "") {
      errors.push(`Row ${row.rowNumber}: Invalid company name.`);
    }

    // Validate contactName
    if (typeof contactName !== "string" || /\d/.test(contactName)) {
      errors.push(
        `Row ${row.rowNumber}: Contact name contains invalid characters or numbers.`
      );
    }

    // Validate contactEmail
    if (typeof contactEmail !== "string" || !contactEmail.includes("@")) {
      errors.push(`Row ${row.rowNumber}: Invalid email format.`);
    }

    // Optional: Validate contactPhone
    if (
      contactPhone &&
      (typeof contactPhone !== "string" || !/^[\d\-\+\s]+$/.test(contactPhone))
    ) {
      errors.push(`Row ${row.rowNumber}: Invalid phone number format.`);
    }

    // Optional: Validate linkedInUrl
    if (linkedInUrl) {
      try {
        let candidate = String(linkedInUrl).trim();

        // If user provided a bare hostname like "linkedin.com/..." or "www.linkedin.com/...",
        // prefix with https://www. so the canonicalizer can parse it.
        if (
          !/^https?:\/\//i.test(candidate) &&
          candidate.toLowerCase().includes("linkedin.com")
        ) {
          if (!candidate.toLowerCase().startsWith("www.")) {
            candidate = `https://www.${candidate}`;
          } else {
            candidate = `https://${candidate}`;
          }
        }

        // Use canonicalizer (already imported) to validate + normalize
        const canon = canonicalizeLinkedInUrl(candidate);
        if (!canon) {
          errors.push(`Row ${row.rowNumber}: Invalid LinkedIn URL.`);
        } else {
          // Inject normalized URL so downstream code sees the canonical form
          rawData.linkedInUrl = canon;
        }
      } catch (e) {
        errors.push(`Row ${row.rowNumber}: Invalid LinkedIn URL.`);
      }
    }

    // Optional: Validate companySize
    if (companySize && isNaN(parseInt(companySize, 10))) {
      errors.push(`Row ${row.rowNumber}: Invalid company size.`);
    }

    if (errors.length > 0) {
      console.warn(
        `[validateRowData] Row ${
          row.rowNumber
        } validation failed: ${errors.join("; ")}`
      );
    } else {
      console.log(`[validateRowData] Row ${row.rowNumber} validation passed`);
    }

    // Inject canonical keys into rawData so downstream code can destructure
    try {
      // Only inject when we have a mapping (i.e. when structure is shuffled)
      if (columnMapping && typeof rawData === "object" && rawData !== null) {
        // Prefer mapped values, fall back to existing canonical keys if present
        const injCompany =
          rawData[columnMapping.companyName] ?? rawData.companyName;
        const injEmail =
          rawData[columnMapping.contactEmail] ?? rawData.contactEmail;
        const injName =
          rawData[columnMapping.contactName] ?? rawData.contactName;
        const injPhone = columnMapping.contactPhone
          ? rawData[columnMapping.contactPhone]
          : rawData.contactPhone;
        const injLinkedIn = columnMapping.linkedInUrl
          ? rawData[columnMapping.linkedInUrl]
          : rawData.linkedInUrl;
        const injCompanySize = columnMapping.companySize
          ? rawData[columnMapping.companySize]
          : rawData.companySize;

        // Mutate the object in-place (this affects the row.rawData in memory)
        rawData.companyName = injCompany;
        rawData.contactEmail = injEmail;
        rawData.contactName = injName;
        if (typeof injPhone !== "undefined") rawData.contactPhone = injPhone;
        if (typeof injLinkedIn !== "undefined")
          rawData.linkedInUrl = injLinkedIn;
        if (typeof injCompanySize !== "undefined")
          rawData.companySize = injCompanySize;

        // Attach the mapping for debugging / reuse
        rawData._columnMapping = columnMapping;
      }
    } catch (injectErr) {
      console.warn(
        `[validateRowData] Failed to inject canonical keys for row ${row.rowNumber}:`,
        injectErr
      );
    }

    // Optionally attach columnMapping to errors as the first element when mapping was used
    return errors;
  } catch (error) {
    console.error(
      `[validateRowData] Exception validating row ${row.rowNumber}:`,
      error
    );
    errors.push(`Row ${row.rowNumber}: Validation error - ${error.message}`);
    return errors;
  }
};

/**
 * Process a CSV Import Job in batches.
 * @param {string} jobId - The ID of the CSV import job.
 */
export const processCsvImportJob = async (jobId) => {
  console.log(`[processCsvImportJob] === START BATCH === JobId: ${jobId}`);

  try {
    const batchSize = 5;

    const job = await fetchJobDetails(jobId);
    if (!job) {
      console.log(
        `[processCsvImportJob] Skipping batch for job ${jobId}, job not in correct state`
      );
      return;
    }
    console.log(
      `[processCsvImportJob] Processing job ${jobId}, Status: ${job.status}`
    );

    const rows = await fetchQueuedRows(jobId, batchSize);
    console.log(`[processCsvImportJob] Fetched ${rows.length} QUEUED rows`);

    if (rows.length === 0) {
      try {
        await prisma.csvImportJob.update({
          where: { id: jobId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        console.log(
          `[processCsvImportJob] === COMPLETED === Job ${jobId} marked as COMPLETED`
        );
      } catch (updateError) {
        console.error(
          `[processCsvImportJob] Failed to mark job ${jobId} as COMPLETED:`,
          updateError
        );
      }
      return;
    }

    let processedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      try {
        console.log(
          `[processCsvImportJob] Processing row ${row.rowNumber} (ID: ${row.id})`
        );
        const result = await processRow(
          row,
          job,
          job.dedupePolicy,
          job.importMode
        );

        if (result.status === "PROCESSED") {
          processedCount++;
          console.log(`[processCsvImportJob] Row ${row.rowNumber} PROCESSED`);
        } else if (result.status === "DUPLICATE") {
          duplicateCount++;
          console.log(`[processCsvImportJob] Row ${row.rowNumber} DUPLICATE`);
        } else if (result.status === "FAILED") {
          failedCount++;
          console.log(`[processCsvImportJob] Row ${row.rowNumber} FAILED`);
        }
      } catch (error) {
        failedCount++;
        console.error(
          `[processCsvImportJob] CRITICAL: Row ${row.rowNumber} processing failed:`,
          error
        );

        try {
          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: {
              status: "FAILED",
              processedAt: new Date(),
              error: error.message || "Unknown processing error",
            },
          });
        } catch (updateError) {
          console.error(
            `[processCsvImportJob] Failed to update row ${row.id} status:`,
            updateError
          );
        }
      }
    }

    try {
      await updateJobCounters(
        jobId,
        processedCount,
        duplicateCount,
        failedCount
      );
      console.log(
        `[processCsvImportJob] Batch complete - Processed: ${processedCount}, Duplicates: ${duplicateCount}, Failed: ${failedCount}`
      );
    } catch (counterError) {
      console.error(
        `[processCsvImportJob] Failed to update job counters:`,
        counterError
      );
    }

    console.log(`[processCsvImportJob] Re-queuing job ${jobId} for next batch`);
    setImmediate(() => processCsvImportJob(jobId));
  } catch (error) {
    console.error(
      `[processCsvImportJob] === CRITICAL ERROR === JobId: ${jobId}`,
      error
    );
  }
};

// Helper function to fetch job details and validate status
const fetchJobDetails = async (jobId) => {
  console.log(`[fetchJobDetails] Fetching job ${jobId}`);

  try {
    const job = await prisma.csvImportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      console.error(`[fetchJobDetails] Job not found: ${jobId}`);
      throw new Error("Job not found");
    }

    if (job.status !== "PROCESSING") {
      console.warn(
        `[fetchJobDetails] Job ${jobId} not in PROCESSING state (status: ${job.status})`
      );

      if (job.status === "QUEUED") {
        const retryLimit = parseInt(
          process.env.RETRY_COUNT_MAX_LIMIT || "5",
          10
        );

        if (job.retryCount >= retryLimit) {
          try {
            await prisma.csvImportJob.update({
              where: { id: jobId },
              data: { status: "FAILED", completedAt: new Date() },
            });
            console.error(
              `[fetchJobDetails] Job ${jobId} marked as FAILED - Retry limit (${retryLimit}) reached`
            );
          } catch (updateError) {
            console.error(
              `[fetchJobDetails] Failed to mark job ${jobId} as FAILED:`,
              updateError
            );
          }
          return null;
        }

        try {
          await prisma.csvImportJob.update({
            where: { id: jobId },
            data: { retryCount: job.retryCount + 1, status: "QUEUED" },
          });
          console.log(
            `[fetchJobDetails] Job ${jobId} re-queued (retry ${
              job.retryCount + 1
            })`
          );
        } catch (updateError) {
          console.error(
            `[fetchJobDetails] Failed to re-queue job ${jobId}:`,
            updateError
          );
        }
        return null;
      } else {
        console.log(
          `[fetchJobDetails] Skipping job ${jobId} (status: ${job.status})`
        );
        return null;
      }
    }

    console.log(`[fetchJobDetails] Job ${jobId} fetched successfully`);
    return job;
  } catch (error) {
    console.error(`[fetchJobDetails] Error fetching job ${jobId}:`, error);
    throw error;
  }
};

// Helper function to fetch job counters
const fetchJobCounters = async (jobId) => {
  console.log(`[fetchJobCounters] Fetching counters for job ${jobId}`);

  try {
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
  } catch (error) {
    console.error(
      `[fetchJobCounters] Error fetching counters for job ${jobId}:`,
      error
    );
    throw error;
  }
};

// Helper function to fetch queued rows
const fetchQueuedRows = async (jobId, batchSize) => {
  console.log(
    `[fetchQueuedRows] Fetching up to ${batchSize} QUEUED rows for job ${jobId}`
  );

  try {
    const rows = await prisma.csvImportRow.findMany({
      where: { jobId, status: "QUEUED" },
      orderBy: { rowNumber: "asc" },
      take: batchSize,
    });
    console.log(`[fetchQueuedRows] Found ${rows.length} QUEUED rows`);
    return rows;
  } catch (error) {
    console.error(
      `[fetchQueuedRows] Error fetching rows for job ${jobId}:`,
      error
    );
    throw error;
  }
};

// Helper function to process a single row
const processRow = async (row, job, dedupePolicy, importMode) => {
  console.log(
    `[processRow] === START === Row ${row.rowNumber} (ID: ${row.id}), Job: ${job.id}`
  );

  try {
    const rawData = row.rawData;

    // Validate row data
    const validationErrors = validateRowData(row, rawData);
    if (validationErrors.length > 0) {
      const errorString = validationErrors.join("; ");
      // Log an explicit message so operator can see failure in logs
      console.warn(
        `[processRow] Validation FAILED for row ${row.rowNumber}: ${errorString}`
      );

      // Also log the offending values to help debugging
      try {
        console.error(`[processRow] Row ${row.rowNumber} rawData:`, rawData);
        console.error(
          `[processRow] Row ${row.rowNumber} canonical values: companyName=${rawData.companyName}, contactName=${rawData.contactName}, contactEmail=${rawData.contactEmail}, contactPhone=${rawData.contactPhone}, linkedInUrl=${rawData.linkedInUrl}`
        );
        if (rawData && rawData._columnMapping) {
          console.error(
            `[processRow] Row ${row.rowNumber} column mapping:`,
            rawData._columnMapping
          );
        }
      } catch (logErr) {
        console.error(
          `[processRow] Failed to log invalid values for row ${row.rowNumber}:`,
          logErr
        );
      }

      // Create a structured debug payload and persist it to the row.error so
      // the operator can inspect failures without console access. Include invalidValues.
      const debug = {
        message: errorString,
        columnMapping:
          rawData && rawData._columnMapping ? rawData._columnMapping : null,
        invalidValues: {
          companyName:
            rawData && rawData.companyName !== undefined
              ? rawData.companyName
              : null,
          contactName:
            rawData && rawData.contactName !== undefined
              ? rawData.contactName
              : null,
          contactEmail:
            rawData && rawData.contactEmail !== undefined
              ? rawData.contactEmail
              : null,
          contactPhone:
            rawData && rawData.contactPhone !== undefined
              ? rawData.contactPhone
              : null,
          linkedInUrl:
            rawData && rawData.linkedInUrl !== undefined
              ? rawData.linkedInUrl
              : null,
        },
        rawDataSample: undefined,
      };

      try {
        const rawStr = JSON.stringify(rawData || {});
        debug.rawDataSample =
          rawStr.length > 2000
            ? rawStr.slice(0, 2000) + "... (truncated)"
            : rawStr;
      } catch (e) {
        debug.rawDataSample = `unable to stringify rawData: ${e.message}`;
      }

      try {
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            error: JSON.stringify(debug),
          },
        });
      } catch (updateError) {
        console.error(
          `[processRow] Failed to update row ${row.id} with validation errors:`,
          updateError
        );
      }
      return { status: "FAILED" };
    }

    // Extract fields from rawData
    const {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      linkedInUrl,
      companySize,
    } = rawData;

    const mappedFields = {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      linkedInUrl,
      companySize: companySize ? parseInt(companySize, 10) : null,
      tenantId: job.tenantId,
    };

    // Normalize fields
    console.log(`[processRow] Normalizing fields for row ${row.rowNumber}`);
    let email = normalizeEmail(mappedFields.contactEmail);
    // Fallback: accept emails that contain '@' but don't have a TLD (e.g. urvashi@productimate)
    if (
      !email &&
      mappedFields.contactEmail &&
      String(mappedFields.contactEmail).includes("@")
    ) {
      email = String(mappedFields.contactEmail).trim().toLowerCase();
      console.warn(
        `[processRow] normalizeEmail failed; falling back to raw email for row ${row.rowNumber}: ${email}`
      );
    }
    const phone = normalizePhone(mappedFields.contactPhone);
    const domainPlusName = deriveDomainPlusName(
      email,
      mappedFields.companyName
    );
    const normalizedLinkedInUrl = canonicalizeLinkedInUrl(
      mappedFields.linkedInUrl
    );

    console.log(
      `[processRow] Normalized - Email: ${email}, Phone: ${phone}, LinkedIn: ${normalizedLinkedInUrl}`
    );

    const contactEmailArray = email ? [email] : [];

    // Deduplication logic
    console.log(
      `[processRow] Checking for duplicates using policy: ${dedupePolicy}`
    );
    let existingLead = null;

    try {
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
    } catch (dedupeError) {
      console.error(`[processRow] Error checking for duplicates:`, dedupeError);
      throw new Error(`Duplicate check failed: ${dedupeError.message}`);
    }

    if (existingLead) {
      console.log(
        `[processRow] Found existing lead (ID: ${existingLead.id}) using ${dedupePolicy}`
      );
    } else {
      console.log(`[processRow] No duplicate found`);
    }

    // Apply importMode
    if (importMode === "DRY_RUN") {
      console.log(`[processRow] DRY_RUN mode - Skipping row ${row.rowNumber}`);
      try {
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: { status: "SKIPPED", processedAt: new Date() },
        });
      } catch (updateError) {
        console.error(
          `[processRow] Failed to mark row ${row.id} as SKIPPED:`,
          updateError
        );
      }
      return { status: "SKIPPED" };
    } else if (importMode === "INSERT_ONLY") {
      if (existingLead) {
        console.log(
          `[processRow] INSERT_ONLY: Duplicate found (Lead ID: ${existingLead.id}), marking as DUPLICATE`
        );
        try {
          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: { status: "DUPLICATE", processedAt: new Date() },
          });
        } catch (updateError) {
          console.error(
            `[processRow] Failed to mark row ${row.id} as DUPLICATE:`,
            updateError
          );
        }
        return { status: "DUPLICATE" };
      } else {
        console.log(`[processRow] INSERT_ONLY: Creating new lead`);
        console.log(
          "[processRow] Mapped Fields:",
          mappedFields,
          "for job id: ",
          job.id
        );
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
              jobId: job.id,
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

          console.log(
            `[processRow] INSERT_ONLY: Created new lead (ID: ${newLead.id})`
          );
          return { status: "PROCESSED" };
        } catch (error) {
          if (error.code === "P2002") {
            console.warn(
              `[processRow] INSERT_ONLY: Race condition duplicate (P2002)`
            );
            try {
              await prisma.csvImportRow.update({
                where: { id: row.id },
                data: { status: "DUPLICATE", processedAt: new Date() },
              });
            } catch (updateError) {
              console.error(
                `[processRow] Failed to mark row ${row.id} as DUPLICATE after P2002:`,
                updateError
              );
            }
            return { status: "DUPLICATE" };
          } else {
            console.error(
              `[processRow] INSERT_ONLY: Failed to create lead:`,
              error
            );
            throw error;
          }
        }
      }
    } else if (importMode === "UPSERT") {
      if (existingLead) {
        console.log(
          `[processRow] UPSERT: Updating existing lead (ID: ${existingLead.id})`
        );
        try {
          // await prisma.lead.update({
          //   where: { id: existingLead.id },
          //   data: {
          //     companyName: mappedFields.companyName,
          //     contactName: mappedFields.contactName,
          //     contactEmail: contactEmailArray,
          //     contactPhone: phone ? [phone] : [],
          //     linkedInUrl: mappedFields.linkedInUrl,
          //     companySize: mappedFields.companySize,
          //     csvJobId: job.id,
          //   },
          // });

          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: {
              status: "DUPLICATE",
              createdLeadId: existingLead.id,
              processedAt: new Date(),
            },
          });

          console.log(
            `[processRow] UPSERT: Updated lead (ID: ${existingLead.id})`
          );
          return { status: "DUPLICATE" };
        } catch (updateError) {
          // Handle unique constraint (P2002) as a logical duplicate rather than crashing
          if (updateError && updateError.code === "P2002") {
            console.warn(
              `[processRow] UPSERT: Unique constraint (P2002) on update for lead ${existingLead.id}. Marking row as DUPLICATE.`
            );
            try {
              await prisma.csvImportRow.update({
                where: { id: row.id },
                data: { status: "DUPLICATE", processedAt: new Date() },
              });
            } catch (markErr) {
              console.error(
                `[processRow] Failed to mark row ${row.id} as DUPLICATE after P2002 on update:`,
                markErr
              );
            }
            return { status: "DUPLICATE" };
          }

          console.error(
            `[processRow] UPSERT: Failed to update lead ${existingLead.id}:`,
            updateError
          );
          throw updateError;
        }
      } else {
        console.log(`[processRow] UPSERT: Creating new lead`);
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
              csvJobId: job.id,
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

          console.log(
            `[processRow] UPSERT: Created new lead (ID: ${newLead.id})`
          );
          return { status: "PROCESSED" };
        } catch (error) {
          if (error.code === "P2002") {
            console.warn(
              `[processRow] UPSERT: Race condition duplicate (P2002)`
            );
            try {
              await prisma.csvImportRow.update({
                where: { id: row.id },
                data: { status: "DUPLICATE", processedAt: new Date() },
              });
            } catch (updateError) {
              console.error(
                `[processRow] Failed to mark row ${row.id} as DUPLICATE after P2002:`,
                updateError
              );
            }
            return { status: "DUPLICATE" };
          } else {
            console.error(`[processRow] UPSERT: Failed to create lead:`, error);
            throw error;
          }
        }
      }
    }
  } catch (error) {
    // Persist error details to the row so operators can inspect from the DB
    try {
      const errPayload = {
        message: error.message || String(error),
        stack: error.stack
          ? error.stack.length > 2000
            ? error.stack.slice(0, 2000) + "... (truncated)"
            : error.stack
          : null,
        rawDataSample: undefined,
      };
      try {
        const rawStr = JSON.stringify(row && row.rawData ? row.rawData : {});
        errPayload.rawDataSample =
          rawStr.length > 2000
            ? rawStr.slice(0, 2000) + "... (truncated)"
            : rawStr;
      } catch (e) {
        errPayload.rawDataSample = `unable to stringify rawData: ${e.message}`;
      }

      await prisma.csvImportRow.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          processedAt: new Date(),
          error: JSON.stringify(errPayload),
        },
      });
    } catch (persistErr) {
      console.error(
        `[processRow] Failed to persist error for row ${row.id}:`,
        persistErr
      );
    }

    console.error(
      `[processRow] === FAILED === Row ${row.rowNumber} (ID: ${row.id})`,
      error
    );
    throw error;
  }
};

// Helper function to update job counters
const updateJobCounters = async (
  jobId,
  processedCount,
  duplicateCount,
  failedCount
) => {
  console.log(
    `[updateJobCounters] Updating job ${jobId} - Processed: +${processedCount}, Duplicates: +${duplicateCount}, Failed: +${failedCount}`
  );

  try {
    if (processedCount === 0 && duplicateCount === 0 && failedCount === 0) {
      console.log(`[updateJobCounters] No counters to update for job ${jobId}`);
      return;
    }

    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: {
        processedRows: { increment: processedCount },
        duplicateRows: { increment: duplicateCount },
        failedRows: { increment: failedCount },
      },
    });

    console.log(
      `[updateJobCounters] Job ${jobId} counters updated successfully`
    );
  } catch (error) {
    console.error(
      `[updateJobCounters] FAILED to update counters for job ${jobId}:`,
      error
    );
    throw error;
  }
};

/**
 * Worker function to process all CSV import jobs with status QUEUED.
 */
export const processCsvJobs = async () => {
  console.log("[processCsvJobs] === WORKER START === Fetching QUEUED jobs");

  try {
    const jobs = await prisma.csvImportJob.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    if (jobs.length === 0) {
      console.log("[processCsvJobs] No QUEUED jobs found. Worker run complete");
      return;
    }

    console.log(`[processCsvJobs] Found ${jobs.length} QUEUED jobs to process`);

    for (const job of jobs) {
      console.log(`[processCsvJobs] Transitioning job ${job.id} to PROCESSING`);
      try {
        await prisma.csvImportJob.update({
          where: { id: job.id },
          data: { status: "PROCESSING", startedAt: new Date() },
        });

        console.log(
          `[processCsvJobs] Starting async processing for job ${job.id}`
        );
        processCsvImportJob(job.id);
      } catch (jobUpdateError) {
        console.error(
          `[processCsvJobs] FAILED to update status for job ${job.id}:`,
          jobUpdateError
        );
      }
    }

    console.log(
      "[processCsvJobs] === WORKER COMPLETE === All jobs queued for processing"
    );
  } catch (error) {
    console.error("[processCsvJobs] === CRITICAL WORKER ERROR ===", error);
  }
};

export const getObjectStreamCSV = async (objectKey) => {
  console.log(`[getObjectStreamCSV] Fetching from S3: ${objectKey}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_CSV,
      Key: objectKey,
    };

    console.log(
      `[getObjectStreamCSV] S3 params - Bucket: ${params.Bucket}, Key: ${params.Key}`
    );
    const response = await s3.send(new GetObjectCommand(params));
    console.log(`[getObjectStreamCSV] S3 object retrieved successfully`);
    return response.Body;
  } catch (error) {
    console.error(
      `[getObjectStreamCSV] FAILED to get object ${objectKey} from S3:`,
      error
    );
    throw error;
  }
};
