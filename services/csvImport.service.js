// import prisma from "../utils/prisma.client.js";
// import { parse } from "csv-parse";
// import {
//   normalizeEmail,
//   normalizePhone,
//   canonicalizeLinkedInUrl,
//   deriveDomainPlusName,
// } from "../utils/normalization.js";
// import xlsx from "xlsx";
// import { Readable } from "stream";
// import { lead_source } from "@prisma/client";
// import dotenv from "dotenv";
// import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
// dotenv.config();

// const s3 = new S3Client({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
//     secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
//   },
// });

// /**
//  * Service to parse a CSV file and seed rows into the database.
//  * @param {string} jobId - The ID of the CSV import job.
//  */
// export const parseAndSeedCsvService = async ({
//   jobId,
//   objectKey,
//   delimiter = ",",
//   headerRow = 1,
//   updateJobStatus = true,
// }) => {
//   try {
//     console.log(
//       `[parseAndSeedCsvService] Starting for jobId: ${jobId}, objectKey: ${objectKey}`
//     );
//     const startTime = Date.now(); // Fetch the job details if jobId is provided

//     let job;
//     if (jobId) {
//       job = await prisma.csvImportJob.findUnique({
//         where: { id: jobId },
//       });

//       if (!job) {
//         console.error(
//           `[parseAndSeedCsvService] CSV import job not found for jobId: ${jobId}`
//         );
//         throw new Error("CSV import job not found");
//       }

//       if (!job.objectKey && !objectKey) {
//         console.error(
//           `[parseAndSeedCsvService] objectKey not found for jobId: ${jobId}`
//         );
//         throw new Error("CSV import job or objectKey not found");
//       }

//       objectKey = objectKey || job.objectKey;
//       delimiter = job.delimiter || delimiter;
//       // V-- FIX: Use the headerRow as the starting line for parsing, don't increment it yet.
//       // headerRow = (job.headerRow || headerRow) + 1; // <-- DELETE THIS LINE
//       headerRow = job.headerRow || headerRow; // <-- ADD THIS LINE (or just use job.headerRow)
//       // headerRow = (job.headerRow || headerRow) + 1; // Skip the header row
//       console.log(
//         `[parseAndSeedCsvService] Fetched job config: delimiter=${delimiter}, headerRow=${headerRow}`
//       );
//     } // Fetch the CSV file stream from S3

//     console.log(
//       `[parseAndSeedCsvService] Fetching object from S3: ${objectKey}`
//     );
//     const stream = await getObjectStreamCSV(objectKey); // Validate the file content

//     const chunks = [];
//     for await (const chunk of stream) {
//       if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
//         chunks.push(Buffer.from(chunk));
//       } else {
//         console.error(
//           `[parseAndSeedCsvService] Invalid chunk type detected: ${typeof chunk}. Skipping this chunk.`
//         );
//         continue; // Skip invalid chunks
//       }
//     }

//     const buffer = Buffer.concat(chunks);
//     console.log(
//       `[parseAndSeedCsvService] Buffer created, size: ${buffer.length} bytes. Validating...`
//     );

//     if (!isValidCsv(buffer)) {
//       console.error(
//         `[parseAndSeedCsvService] Invalid file format for objectKey: ${objectKey}. Not a valid CSV.`
//       );
//       throw new Error(
//         "Invalid file format. The uploaded file does not appear to be a valid CSV."
//       );
//     } // Convert buffer to a readable stream

//     const bufferStream = Readable.from(buffer); // Recreate the stream for parsing

//     const parser = bufferStream.pipe(
//       // parse({
//       //   delimiter,
//       //   from_line: headerRow,
//       // })
//       parse({
//         delimiter,
//         // V-- FIX: Change from_line and add columns: true
//         from_line: headerRow, // Use the actual header row number (e.g., 1)
//         columns: true, // This is the key change! It parses into objects.
//         skip_empty_lines: true,
//         // A-- End of FIX
//       })
//     );

//     let totalRows = 0; // Use a transaction to ensure atomicity

//     console.log(
//       `[parseAndSeedCsvService] Starting DB transaction to seed rows for job ${jobId}...`
//     );
//     await prisma.$transaction(async (prisma) => {
//       for await (const record of parser) {
//         totalRows++; // Log progress every 1000 rows

//         if (totalRows % 1000 === 0) {
//           console.log(
//             `[parseAndSeedCsvService] Seeded ${totalRows} rows for job ${jobId}...`
//           );
//         } // Seed each row into the database

//         await prisma.csvImportRow.create({
//           data: {
//             jobId,
//             rowNumber: totalRows,
//             rawData: record,
//             status: "QUEUED",
//           },
//         });
//       }

//       console.log(
//         `[parseAndSeedCsvService] Transaction complete. Total rows seeded: ${totalRows}`
//       );

//       if (updateJobStatus && jobId) {
//         // Update the job with the total rows
//         await prisma.csvImportJob.update({
//           where: { id: jobId },
//           data: { totalRows }, // Pass only the integer value of totalRows
//         });
//         console.log(
//           `[parseAndSeedCsvService] Job ${jobId} updated with totalRows: ${totalRows}`
//         );
//       }
//     });

//     const endTime = Date.now();
//     console.log(
//       `[parseAndSeedCsvService] Completed for jobId: ${jobId} in ${
//         endTime - startTime
//       }ms with ${totalRows} rows.`
//     );

//     return { message: "CSV parsed and rows seeded successfully", totalRows };
//   } catch (error) {
//     console.error(`[parseAndSeedCsvService] FAILED for jobId ${jobId}:`, error);
//     throw error;
//   }
// };

// const isValidCsv = (buffer) => {
//   const text = buffer.toString("utf8", 0, 100); // Read the first 100 bytes as text
//   return text.includes(",") || text.includes("\n"); // Basic check for CSV structure
// };

// const isValidXlsx = (buffer) => {
//   const header = buffer.toString("utf8", 0, 4);
//   return header === "PK\u0003\u0004"; // XLSX files start with this signature
// };

// const parseXlsx = (buffer) => {
//   const workbook = xlsx.read(buffer, { type: "buffer" });
//   const sheetName = workbook.SheetNames[0];
//   const sheet = workbook.Sheets[sheetName];
//   return xlsx.utils.sheet_to_json(sheet, { header: 1 }); // Convert to array of arrays
// };

// const isValidCsvOrXlsx = (buffer) => {
//   return isValidCsv(buffer) || isValidXlsx(buffer);
// };

// /**
//  * Service to configure a CSV Import Job.
//  * @param {object} config - The configuration object.
//  */
// export const configureCsvImportService = async (config) => {
//   const {
//     jobId,
//     delimiter,
//     headerRow,
//     columnMapping,
//     importMode,
//     dedupePolicy,
//   } = config;

//   try {
//     console.log(`[configureCsvImportService] Configuring job: ${jobId}`); // Update the CsvImportJob with configuration details
//     await prisma.csvImportJob.update({
//       where: { id: jobId },
//       data: { delimiter, headerRow, columnMapping, importMode, dedupePolicy },
//     });

//     console.log(
//       `[configureCsvImportService] Job ${jobId} configured successfully.`
//     );
//     return { message: "CSV import job configured successfully" };
//   } catch (error) {
//     console.error(
//       `[configureCsvImportService] FAILED for jobId ${jobId}:`,
//       error
//     );
//     throw error;
//   }
// };

// /**
//  * Service to start processing a CSV Import Job.
//  * @param {string} jobId - The ID of the CSV import job.
//  */
// export const startCsvImportService = async (jobId) => {
//   try {
//     console.log(`[startCsvImportService] Starting job: ${jobId}`); // Update the job status to PROCESSING
//     await prisma.csvImportJob.update({
//       where: { id: jobId },
//       data: { status: "PROCESSING", startedAt: new Date() },
//     });

//     console.log(
//       `[startCsvImportService] Job ${jobId} status updated to PROCESSING.`
//     );
//     return { message: "CSV import job started successfully" };
//   } catch (error) {
//     console.error(
//       `[startCsvImportService] FAILED to start job ${jobId}:`,
//       error
//     );
//     throw error;
//   }
// };

// /**
//  * Service to get the status of a CSV Import Job.
//  * @param {string} jobId - The ID of the CSV import job.
//  */
// export const getCsvImportStatusService = async (jobId) => {
//   try {
//     console.log(
//       `[getCsvImportStatusService] Fetching status for job: ${jobId}`
//     ); // Fetch the job details along with progress and recent rows
//     const job = await prisma.csvImportJob.findUnique({
//       where: { id: jobId },
//       include: {
//         rows: {
//           orderBy: { rowNumber: "asc" },
//           take: 10, // Fetch recent rows
//         },
//       },
//     });

//     if (!job) {
//       console.error(
//         `[getCsvImportStatusService] CSV import job not found: ${jobId}`
//       );
//       throw new Error("CSV import job not found");
//     }

//     return job;
//   } catch (error) {
//     console.error(
//       `[getCsvImportStatusService] FAILED to get status for job ${jobId}:`,
//       error
//     );
//     throw error;
//   }
// };

// /**
//  * Create a new CSV Import Job.
//  */
// export const createCsvImportJobService = async ({
//   tenantId,
//   objectKey,
//   columnMapping,
//   importMode,
//   dedupePolicy,
//   delimiter,
//   headerRow,
// }) => {
//   try {
//     console.log(
//       `[createCsvImportJobService] Creating job for tenant: ${tenantId}, objectKey: ${objectKey}`
//     ); // Create the job in the database
//     const job = await prisma.csvImportJob.create({
//       data: {
//         tenantId,
//         objectKey,
//         columnMapping,
//         importMode,
//         dedupePolicy,
//         delimiter,
//         headerRow,
//         status: "QUEUED",
//       },
//     });
//     console.log(
//       `[createCsvImportJobService] Job ${job.id} created. Seeding rows...`
//     ); // Stream the CSV and seed rows

//     const { totalRows } = await parseAndSeedCsvService({
//       objectKey,
//       jobId: job.id,
//       delimiter,
//       headerRow,
//       columnMapping,
//     });

//     console.log(
//       `[createCsvImportJobService] Rows seeded for job ${job.id}. Total: ${totalRows}`
//     );

//     return {
//       jobId: job.id,
//       tenantId: job.tenantId,
//       status: job.status,
//       totalRows,
//       processedRows: 0,
//       duplicateRows: 0,
//       failedRows: 0,
//       createdAt: job.createdAt,
//     };
//   } catch (error) {
//     console.error(
//       `[createCsvImportJobService] FAILED for tenant ${tenantId}, objectKey ${objectKey}:`,
//       error
//     );
//     throw error;
//   }
// };

// /**
//  * Get the status of a specific CSV Import Job.
//  */
// export const getCsvImportJobStatusService = async (jobId) => {
//   try {
//     console.log(
//       `[getCsvImportJobStatusService] Fetching status for job: ${jobId}`
//     );
//     const job = await prisma.csvImportJob.findUnique({
//       where: { id: jobId },
//     });

//     if (!job) {
//       console.error(`[getCsvImportJobStatusService] Job not found: ${jobId}`);
//       throw new Error("Job not found");
//     }

//     return {
//       jobId: job.id,
//       tenantId: job.tenantId,
//       status: job.status,
//       importMode: job.importMode,
//       dedupePolicy: job.dedupePolicy,
//       totalRows: job.totalRows,
//       processedRows: job.processedRows,
//       duplicateRows: job.duplicateRows,
//       failedRows: job.failedRows,
//       createdAt: job.createdAt,
//       startedAt: job.startedAt,
//       completedAt: job.completedAt,
//     };
//   } catch (error) {
//     console.error(
//       `[getCsvImportJobStatusService] FAILED to get status for job ${jobId}:`,
//       error
//     );
//     throw error;
//   }
// };

// /**
//  * List all CSV Import Jobs.
//  */
// export const listCsvImportJobsService = async ({
//   tenantId,
//   status,
//   limit,
//   cursor,
// }) => {
//   try {
//     console.log(
//       `[listCsvImportJobsService] Listing jobs for tenant: ${tenantId}, status: ${status}`
//     );
//     const where = {};

//     if (tenantId) {
//       where.tenantId = tenantId;
//     }

//     if (status) {
//       where.status = { in: status.split(",") };
//     }

//     const jobs = await prisma.csvImportJob.findMany({
//       where,
//       take: limit ? parseInt(limit, 10) : undefined,
//       skip: cursor ? 1 : undefined,
//       cursor: cursor ? { id: cursor } : undefined,
//       orderBy: { createdAt: "desc" },
//     });

//     const nextCursor = jobs.length > 0 ? jobs[jobs.length - 1].id : null;

//     return {
//       items: jobs.map((job) => ({
//         jobId: job.id,
//         tenantId: job.tenantId,
//         status: job.status,
//         totalRows: job.totalRows,
//         processedRows: job.processedRows,
//         duplicateRows: job.duplicateRows,
//         failedRows: job.failedRows,
//         createdAt: job.createdAt,
//         startedAt: job.startedAt,
//         completedAt: job.completedAt,
//       })),
//       nextCursor,
//     };
//   } catch (error) {
//     console.error(`[listCsvImportJobsService] FAILED to list jobs:`, error);
//     throw error;
//   }
// };

// // Function to validate row data
// const validateRowData = (row, rawData) => {
//   const errors = [];

//   // Log the raw data for debugging
//   console.log(`[validateRowData] Raw data for row ${row}:`, rawData);

//   // V-- FIX: Change array validation to object validation
//   if (typeof rawData !== "object" || rawData === null || Array.isArray(rawData)) {
//     errors.push(
//       `Row ${row.rowNumber} has invalid data format. Expected an object.`
//     );
//     return errors;
//   }

//   // Ensure the rawData has at least the first 3 required fields
//   // if (!Array.isArray(rawData) || rawData.length < 3) {
//   //   errors.push(
//   //     `Row ${row.rowNumber} does not have the required fields: companyName, contactName, contactEmail.`
//   //   );
//   //   return errors;
//   // }

//   // Validate each field in the specified order
//   const {
//     companyName,
//     contactEmail,
//     contactName,
//     contactPhone, // Optional
//     linkedInUrl, // Optional
//     companySize, // Optional
//   } = rawData;

//   // Check if companyName is a valid string
//   if (typeof companyName !== "string" || companyName.trim() === "") {
//     errors.push(`Row ${row.rowNumber}: Invalid company name.`);
//   }

//   // Check if contactName is a valid string and does not contain numbers
//   if (typeof contactName !== "string" || /\d/.test(contactName)) {
//     errors.push(
//       `Row ${row.rowNumber}: Contact name contains invalid characters or numbers.`
//     );
//   }

//   // Check if contactEmail contains '@'
//   if (typeof contactEmail !== "string" || !contactEmail.includes("@")) {
//     // console.log("type of contactEmail" , typeof contactEmail);
//     errors.push(`Row ${row.rowNumber}: Invalid email format.`);
//   }

//   // Optional fields validation
//   if (contactPhone) {
//     // Check if contactPhone is a valid string (basic validation for phone number)
//     if (
//       typeof contactPhone !== "string" ||
//       !/^[\d\-\+\s]+$/.test(contactPhone)
//     ) {
//       errors.push(`Row ${row.rowNumber}: Invalid phone number format.`);
//     }
//   }

//   if (linkedInUrl) {
//     // Check if linkedInUrl is a valid URL
//     if (
//       typeof linkedInUrl !== "string" ||
//       !linkedInUrl.startsWith("https://www.linkedin.com/")
//     ) {
//       console.warn(
//         `[validateRowData] Row ${
//           row.rowNumber
//         }: Invalid LinkedIn URL: ${linkedInUrl} (Type: ${typeof linkedInUrl})`
//       );
//       errors.push(`Row ${row.rowNumber}: Invalid LinkedIn URL.`);
//     }
//   }

//   if (companySize) {
//     // Check if companySize is a valid number
//     if (isNaN(parseInt(companySize, 10))) {
//       errors.push(`Row ${row.rowNumber}: Invalid company size.`);
//     }
//   }

//   console.log(errors)

//   return errors;
// };

// /**
//  * Process a CSV Import Job in batches.
//  * @param {string} jobId - The ID of the CSV import job.
//  */
// export const processCsvImportJob = async (jobId) => {
//   try {
//     const batchSize = 5;

//     const job = await fetchJobDetails(jobId);
//     if (!job) {
//       console.log(
//         `[processCsvImportJob] Skipping batch for job ${jobId}, job not found or not in correct state.`
//       );
//       return;
//     }
//     console.log(
//       `[processCsvImportJob] Fetched job ${jobId}. Status: ${job.status}`
//     ); // Fetch job counters (not strictly needed here, but good for context if debugging) // const { processedRows, duplicateRows, failedRows } = await fetchJobCounters( //   jobId // ); // Fetch a batch of QUEUED rows

//     const rows = await fetchQueuedRows(jobId, batchSize);
//     console.log(`[processCsvImportJob] Fetched ${rows.length} rows for batch.`);

//     if (rows.length === 0) {
//       // Mark job as COMPLETED if no QUEUED rows remain
//       await prisma.csvImportJob.update({
//         where: { id: jobId },
//         data: { status: "COMPLETED", completedAt: new Date() },
//       });
//       console.log(
//         `[processCsvImportJob] Job ${jobId} marked as COMPLETED. No more QUEUED rows.`
//       );
//       return;
//     }

//     let processedCount = 0;
//     let duplicateCount = 0;
//     let failedCount = 0;

//     for (const row of rows) {
//       try {
//         const result = await processRow(
//           row,
//           job,
//           job.dedupePolicy,
//           job.importMode
//         );
//         if (result.status === "PROCESSED") processedCount++;
//         else if (result.status === "DUPLICATE") duplicateCount++;
//         else if (result.status === "FAILED") failedCount++; // "SKIPPED" (for DRY_RUN) doesn't increment a counter, which is fine
//       } catch (error) {
//         failedCount++;
//         console.error(
//           `[processCsvImportJob] FAILED to process row ${row.rowNumber} (rowId: ${row.id}) for job ${jobId}:`,
//           error.message
//         );
//         console.error(
//           `[processCsvImportJob] Row Raw Data: ${JSON.stringify(row.rawData)}`
//         );
//         console.error(`[processCsvImportJob] Stack Trace:`, error.stack);
//         await prisma.csvImportRow.update({
//           where: { id: row.id },
//           data: {
//             status: "FAILED",
//             processedAt: new Date(),
//             error: error.message || "Unknown processing error",
//           },
//         });
//       }
//     } // Update job counters

//     await updateJobCounters(jobId, processedCount, duplicateCount, failedCount);
//     console.log(
//       `[processCsvImportJob] Batch complete for job ${jobId}. Processed ${rows.length} rows.`
//     ); // Requeue the job for further processing

//     console.log(
//       `[processCsvImportJob] Re-queuing job ${jobId} for next batch.`
//     );
//     setImmediate(() => processCsvImportJob(jobId));
//   } catch (error) {
//     console.error(
//       `[processCsvImportJob] CRITICAL error in job ${jobId}:`,
//       error.message
//     );
//     console.error("[processCsvImportJob] Stack Trace:", error.stack); // Don't re-throw here, as it would crash the worker. // The job will remain in "PROCESSING" state and will be picked up again // by the fetchJobDetails logic (which handles re-queuing or failure).
//   }
// };

// // Helper function to fetch job details and validate status
// const fetchJobDetails = async (jobId) => {
//   const job = await prisma.csvImportJob.findUnique({ where: { id: jobId } });

//   if (!job) {
//     console.error(`[fetchJobDetails] Job not found: ${jobId}`);
//     throw new Error("Job not found");
//   }

//   if (job.status !== "PROCESSING") {
//     console.warn(
//       `[fetchJobDetails] Job ${jobId} is not in PROCESSING state (status: ${job.status}). Checking for re-queue or failure.`
//     );
//     if (job.status === "QUEUED") {
//       const retryLimit = parseInt(process.env.RETRY_COUNT_MAX_LIMIT || "5", 10);
//       if (job.retryCount >= retryLimit) {
//         await prisma.csvImportJob.update({
//           where: { id: jobId },
//           data: { status: "FAILED", completedAt: new Date() },
//         });
//         console.error(
//           `[fetchJobDetails] Job ${jobId} marked as FAILED. Retry limit (${retryLimit}) reached.`
//         );
//         return null;
//       }

//       await prisma.csvImportJob.update({
//         where: { id: jobId },
//         data: { retryCount: job.retryCount + 1, status: "QUEUED" },
//       });
//       console.log(
//         `[fetchJobDetails] Job ${jobId} re-queued (retry ${
//           job.retryCount + 1
//         }).`
//       );
//       return null;
//     } else {
//       console.log(
//         `[fetchJobDetails] Skipping job ${jobId} (status: ${job.status}).`
//       );
//       return null; // Skip jobs that are COMPLETED, FAILED, etc.
//     }
//   }

//   return job;
// };

// // Helper function to fetch job counters
// const fetchJobCounters = async (jobId) => {
//   const jobCounters = await prisma.csvImportJob.findUnique({
//     where: { id: jobId },
//     select: {
//       processedRows: true,
//       duplicateRows: true,
//       failedRows: true,
//     },
//   });

//   return {
//     processedRows: jobCounters?.processedRows || 0,
//     duplicateRows: jobCounters?.duplicateRows || 0,
//     failedRows: jobCounters?.failedRows || 0,
//   };
// };

// // Helper function to fetch queued rows
// const fetchQueuedRows = async (jobId, batchSize) => {
//   return await prisma.csvImportRow.findMany({
//     where: { jobId, status: "QUEUED" },
//     orderBy: { rowNumber: "asc" },
//     take: batchSize,
//   });
// };

// // Helper function to process a single row
// const processRow = async (row, job, dedupePolicy, importMode) => {
//   console.log(
//     `[processRow] Processing row ${row.rowNumber} (rowId: ${row.id}) for job ${job.id}`
//   );
//   const rawData = row.rawData; // Validate row data

//   const validationErrors = validateRowData(row, rawData);
//   if (validationErrors.length > 0) {
//     const errorString = validationErrors.join("; ");
//     console.warn(
//       `[processRow] Validation FAILED for row ${row.rowNumber} (rowId: ${row.id}). Errors: ${errorString}`
//     );
//     await prisma.csvImportRow.update({
//       where: { id: row.id },
//       data: {
//         status: "FAILED",
//         processedAt: new Date(),
//         error: errorString,
//       },
//     });
//     return { status: "FAILED" };
//   } // Map rawData to fields

//   // const [
//   //   companyName,
//   //   contactEmail,
//   //   contactName,
//   //   contactPhone, // Optional
//   //   linkedInUrl, // Optional
//   //   companySize,
//   // ] = rawData;
//   const {
//     companyName,
//     contactEmail,
//     contactName,
//     contactPhone, // Optional
//     linkedInUrl, // Optional
//     companySize,
//   } = rawData;
//   // const mappedFields = {
//   //   companyName,
//   //   contactEmail,
//   //   contactName,
//   //   contactPhone,
//   //   linkedInUrl,
//   //   companySize: parseInt(companySize, 10),
//   //   tenantId: job.tenantId,
//   // }; // Normalize fields

//   const mappedFields = {
//     companyName,
//     contactEmail,
//     contactName,
//     contactPhone,
//     linkedInUrl,
//     // Safer parsing for optional number
//     companySize: companySize ? parseInt(companySize, 10) : null, 
//     tenantId: job.tenantId,
//   };

//   const email = normalizeEmail(mappedFields.contactEmail);
//   const phone = normalizePhone(mappedFields.contactPhone);
//   const domainPlusName = deriveDomainPlusName(email, mappedFields.companyName);
//   const normalizedLinkedInUrl = canonicalizeLinkedInUrl(
//     mappedFields.linkedInUrl
//   );

//   console.log(
//     `[processRow] Normalized data: email=${email}, phone=${phone}, linkedIn=${normalizedLinkedInUrl}`
//   ); // Ensure contactEmail is an array if required by Prisma schema

//   const contactEmailArray = email ? [email] : []; // Deduplication logic
//   console.log(`[processRow] Dedupe policy: ${dedupePolicy}.`);
//   let existingLead = null;
//   if (dedupePolicy === "EMAIL" && email) {
//     existingLead = await prisma.lead.findFirst({
//       where: { tenantId: job.tenantId, contactEmail: { has: email } },
//     });
//   } else if (dedupePolicy === "PHONE" && phone) {
//     existingLead = await prisma.lead.findFirst({
//       where: { tenantId: job.tenantId, contactPhone: { has: phone } },
//     });
//   } else if (dedupePolicy === "DOMAIN_PLUS_NAME" && domainPlusName) {
//     existingLead = await prisma.lead.findFirst({
//       where: {
//         tenantId: job.tenantId, // This logic might need adjustment based on your exact domain+name definition // Assuming domain is stored in contactEmail array and name in companyName
//         contactEmail: { has: domainPlusName.domain },
//         companyName: domainPlusName.name,
//       },
//     });
//   } else if (dedupePolicy === "LINKEDIN_URL" && normalizedLinkedInUrl) {
//     existingLead = await prisma.lead.findFirst({
//       where: {
//         tenantId: job.tenantId,
//         linkedInUrl: normalizedLinkedInUrl,
//       },
//     });
//   }

//   if (existingLead) {
//     console.log(
//       `[processRow] Found existing lead (ID: ${existingLead.id}) based on ${dedupePolicy}.`
//     );
//   } // Apply importMode

//   if (importMode === "DRY_RUN") {
//     console.log(`[processRow] DRY_RUN: Skipping row ${row.rowNumber}.`);
//     await prisma.csvImportRow.update({
//       where: { id: row.id },
//       data: { status: "SKIPPED", processedAt: new Date() },
//     });
//     return { status: "SKIPPED" };
//   } else if (importMode === "INSERT_ONLY") {
//     if (existingLead) {
//       console.log(
//         `[processRow] INSERT_ONLY: Found duplicate (Lead ID: ${existingLead.id}). Marking as DUPLICATE.`
//       );
//       await prisma.csvImportRow.update({
//         where: { id: row.id },
//         data: { status: "DUPLICATE", processedAt: new Date() },
//       });
//       return { status: "DUPLICATE" };
//     } else {
//       console.log(
//         `[processRow] INSERT_ONLY: No duplicate found. Creating new lead...`
//       );
//       try {
//         const newLead = await prisma.lead.create({
//           data: {
//             tenantId: job.tenantId,
//             companyName: mappedFields.companyName,
//             contactName: mappedFields.contactName,
//             contactEmail: contactEmailArray,
//             contactPhone: phone ? [phone] : [],
//             source: lead_source.CSV_UPLOAD,
//             linkedInUrl: mappedFields.linkedInUrl,
//             companySize: mappedFields.companySize,
//           },
//         });
//         await prisma.csvImportRow.update({
//           where: { id: row.id },
//           data: {
//             status: "PROCESSED",
//             createdLeadId: newLead.id,
//             processedAt: new Date(),
//           },
//         });
//         console.log(
//           `[processRow] INSERT_ONLY: Created new lead (ID: ${newLead.id}).`
//         );
//         return { status: "PROCESSED" };
//       } catch (error) {
//         if (error.code === "P2002") {
//           console.warn(
//             `[processRow] INSERT_ONLY: Race condition duplicate (P2002). Marking as DUPLICATE.`
//           );
//           await prisma.csvImportRow.update({
//             where: { id: row.id },
//             data: { status: "DUPLICATE", processedAt: new Date() },
//           });
//           return { status: "DUPLICATE" };
//         } else {
//           console.error(
//             `[processRow] INSERT_ONLY: FAILED to create lead for row ${row.rowNumber}:`,
//             error
//           );
//           throw error;
//         }
//       }
//     }
//   } else if (importMode === "UPSERT") {
//     if (existingLead) {
//       console.log(
//         `[processRow] UPSERT: Found existing lead (ID: ${existingLead.id}). Updating...`
//       );
//       await prisma.lead.update({
//         where: { id: existingLead.id },
//         data: {
//           companyName: mappedFields.companyName,
//           contactName: mappedFields.contactName,
//           contactEmail: contactEmailArray,
//           contactPhone: phone ? [phone] : [],
//           linkedInUrl: mappedFields.linkedInUrl,
//           companySize: mappedFields.companySize,
//         },
//       });
//       await prisma.csvImportRow.update({
//         where: { id: row.id },
//         data: {
//           status: "PROCESSED",
//           createdLeadId: existingLead.id,
//           processedAt: new Date(),
//         },
//       });
//       console.log(
//         `[processRow] UPSERT: Updated existing lead (ID: ${existingLead.id}).`
//       );
//       return { status: "PROCESSED" };
//     } else {
//       console.log(
//         `[processRow] UPSERT: No existing lead. Creating new lead...`
//       );
//       try {
//         const newLead = await prisma.lead.create({
//           data: {
//             tenantId: job.tenantId,
//             companyName: mappedFields.companyName,
//             contactName: mappedFields.contactName,
//             contactEmail: contactEmailArray,
//             contactPhone: phone ? [phone] : [],
//             source: lead_source.CSV_UPLOAD,
//             linkedInUrl: mappedFields.linkedInUrl,
//             companySize: mappedFields.companySize,
//           },
//         });
//         await prisma.csvImportRow.update({
//           where: { id: row.id },
//           data: {
//             status: "PROCESSED",
//             createdLeadId: newLead.id,
//             processedAt: new Date(),
//           },
//         });
//         console.log(
//           `[processRow] UPSERT: Created new lead (ID: ${newLead.id}).`
//         );
//         return { status: "PROCESSED" };
//       } catch (error) {
//         if (error.code === "P2002") {
//           console.warn(
//             `[processRow] UPSERT: Race condition duplicate (P2002). Marking as DUPLICATE.`
//           );
//           await prisma.csvImportRow.update({
//             where: { id: row.id },
//             data: { status: "DUPLICATE", processedAt: new Date() },
//           });
//           return { status: "DUPLICATE" };
//         } else {
//           console.error(
//             `[processRow] UPSERT: FAILED to create lead for row ${row.rowNumber}:`,
//             error
//           );
//           throw error;
//         }
//       }
//     }
//   }
// };

// // Helper function to update job counters
// const updateJobCounters = async (
//   jobId,
//   processedCount,
//   duplicateCount,
//   failedCount
// ) => {
//   try {
//     if (processedCount === 0 && duplicateCount === 0 && failedCount === 0) {
//       return; // No counters to update
//     }
//     console.log(
//       `[updateJobCounters] Updating counters for job ${jobId}: +${processedCount} processed, +${duplicateCount} duplicate, +${failedCount} failed.`
//     );
//     await prisma.csvImportJob.update({
//       where: { id: jobId },
//       data: {
//         processedRows: { increment: processedCount },
//         duplicateRows: { increment: duplicateCount },
//         failedRows: { increment: failedCount },
//       },
//     });
//   } catch (error) {
//     console.error(
//       `[updateJobCounters] FAILED to update counters for job ${jobId}:`,
//       error
//     ); // Re-throw to be caught by the main batch processor
//     throw error;
//   }
// };

// /**
//  * Worker function to process all CSV import jobs with status QUEUED.
//  */
// export const processCsvJobs = async () => {
//   console.log("[processCsvJobs] Worker starting run. Fetching QUEUED jobs...");
//   try {
//     // Fetch jobs with status QUEUED, limit to 200 rows total
//     const jobs = await prisma.csvImportJob.findMany({
//       where: { status: "QUEUED" },
//       orderBy: { createdAt: "asc" },
//       take: 5, // Limit the total number of jobs to pick up in one worker run
//     });

//     if (jobs.length === 0) {
//       console.log(
//         "[processCsvJobs] No QUEUED jobs found. Worker run complete."
//       );
//       return;
//     }

//     console.log(`[processCsvJobs] Found ${jobs.length} jobs to process.`);

//     for (const job of jobs) {
//       console.log(
//         `[processCsvJobs] Worker: Transitioning job ${job.id} to PROCESSING`
//       );
//       try {
//         // Update job status to PROCESSING
//         await prisma.csvImportJob.update({
//           where: { id: job.id },
//           data: { status: "PROCESSING", startedAt: new Date() },
//         });

//         console.log(`[processCsvJobs] Worker: Processing job ${job.id}`); // Start the job processing (it will run asynchronously via setImmediate)
//         processCsvImportJob(job.id);
//       } catch (jobUpdateError) {
//         console.error(
//           `[processCsvJobs] FAILED to update status for job ${job.id}:`,
//           jobUpdateError
//         ); // Continue to the next job
//       }
//     }
//   } catch (error) {
//     console.error("[processCsvJobs] CRITICAL error in worker:", error); // Do not re-throw, allow the worker to be called again later
//   }
// };

// export const getObjectStreamCSV = async (objectKey) => {
//   try {
//     const params = {
//       Bucket: process.env.S3_BUCKET_CSV, // Ensure this environment variable is set
//       Key: objectKey,
//     };
//     console.log(
//       `[getObjectStreamCSV] Fetching object from S3: ${params.Bucket}/${params.Key}`
//     );
//     const response = await s3.send(new GetObjectCommand(params));
//     return response.Body; // This is a Readable stream
//   } catch (error) {
//     console.error(
//       `[getObjectStreamCSV] FAILED to get object ${objectKey} from S3:`,
//       error
//     );
//     throw error;
//   }
// };



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
  console.log(`[parseAndSeedCsvService] === START === JobId: ${jobId}, ObjectKey: ${objectKey}`);
  const startTime = Date.now();
  
  try {
    // Fetch the job details if jobId is provided
    let job;
    if (jobId) {
      try {
        job = await prisma.csvImportJob.findUnique({
          where: { id: jobId },
        });
        console.log(`[parseAndSeedCsvService] Job fetched successfully: ${jobId}`);
      } catch (dbError) {
        console.error(`[parseAndSeedCsvService] Database error fetching job ${jobId}:`, dbError);
        throw new Error(`Failed to fetch CSV import job: ${dbError.message}`);
      }

      if (!job) {
        console.error(`[parseAndSeedCsvService] CSV import job not found for jobId: ${jobId}`);
        throw new Error("CSV import job not found");
      }

      if (!job.objectKey && !objectKey) {
        console.error(`[parseAndSeedCsvService] objectKey not found for jobId: ${jobId}`);
        throw new Error("CSV import job or objectKey not found");
      }

      objectKey = objectKey || job.objectKey;
      delimiter = job.delimiter || delimiter;
      headerRow = job.headerRow || headerRow;
      
      console.log(`[parseAndSeedCsvService] Job config - delimiter: '${delimiter}', headerRow: ${headerRow}`);
    }

    // Fetch the CSV file stream from S3
    console.log(`[parseAndSeedCsvService] Fetching object from S3: ${objectKey}`);
    let stream;
    try {
      stream = await getObjectStreamCSV(objectKey);
      console.log(`[parseAndSeedCsvService] S3 stream retrieved successfully`);
    } catch (s3Error) {
      console.error(`[parseAndSeedCsvService] S3 fetch error for ${objectKey}:`, s3Error);
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
          console.warn(`[parseAndSeedCsvService] Invalid chunk type: ${typeof chunk}, skipping`);
          continue;
        }
      }
    } catch (streamError) {
      console.error(`[parseAndSeedCsvService] Stream reading error:`, streamError);
      throw new Error(`Failed to read file stream: ${streamError.message}`);
    }

    const buffer = Buffer.concat(chunks);
    console.log(`[parseAndSeedCsvService] Buffer created - Size: ${buffer.length} bytes`);

    if (!isValidCsv(buffer)) {
      console.error(`[parseAndSeedCsvService] Invalid CSV format for: ${objectKey}`);
      throw new Error("Invalid file format. The uploaded file does not appear to be a valid CSV.");
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
      })
    );
    console.log(`[parseAndSeedCsvService] CSV parser initialized`);

    let totalRows = 0;

    // Use a transaction to ensure atomicity
    console.log(`[parseAndSeedCsvService] Starting DB transaction for job ${jobId}...`);
    try {
      await prisma.$transaction(async (prisma) => {
        for await (const record of parser) {
          totalRows++;

          // Log progress every 1000 rows
          if (totalRows % 1000 === 0) {
            console.log(`[parseAndSeedCsvService] Progress: ${totalRows} rows seeded for job ${jobId}`);
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
            console.error(`[parseAndSeedCsvService] Failed to create row ${totalRows} for job ${jobId}:`, rowError);
            throw rowError;
          }
        }

        console.log(`[parseAndSeedCsvService] Transaction complete - Total rows seeded: ${totalRows}`);

        if (updateJobStatus && jobId) {
          try {
            await prisma.csvImportJob.update({
              where: { id: jobId },
              data: { totalRows },
            });
            console.log(`[parseAndSeedCsvService] Job ${jobId} updated with totalRows: ${totalRows}`);
          } catch (updateError) {
            console.error(`[parseAndSeedCsvService] Failed to update job ${jobId}:`, updateError);
            throw updateError;
          }
        }
      });
    } catch (transactionError) {
      console.error(`[parseAndSeedCsvService] Transaction failed for job ${jobId}:`, transactionError);
      throw new Error(`Database transaction failed: ${transactionError.message}`);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`[parseAndSeedCsvService] === SUCCESS === JobId: ${jobId}, Rows: ${totalRows}, Duration: ${duration}ms`);

    return { message: "CSV parsed and rows seeded successfully", totalRows };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.error(`[parseAndSeedCsvService] === FAILED === JobId: ${jobId}, Duration: ${duration}ms`);
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
  const { jobId, delimiter, headerRow, columnMapping, importMode, dedupePolicy } = config;
  console.log(`[configureCsvImportService] === START === JobId: ${jobId}`);

  try {
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { delimiter, headerRow, columnMapping, importMode, dedupePolicy },
    });

    console.log(`[configureCsvImportService] === SUCCESS === Job ${jobId} configured`);
    return { message: "CSV import job configured successfully" };
  } catch (error) {
    console.error(`[configureCsvImportService] === FAILED === JobId: ${jobId}`, error);
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

    console.log(`[startCsvImportService] === SUCCESS === Job ${jobId} status: PROCESSING`);
    return { message: "CSV import job started successfully" };
  } catch (error) {
    console.error(`[startCsvImportService] === FAILED === JobId: ${jobId}`, error);
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

    console.log(`[getCsvImportStatusService] Job ${jobId} status: ${job.status}`);
    return job;
  } catch (error) {
    console.error(`[getCsvImportStatusService] FAILED for job ${jobId}:`, error);
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
  console.log(`[createCsvImportJobService] === START === Tenant: ${tenantId}, ObjectKey: ${objectKey}`);

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

    console.log(`[createCsvImportJobService] === SUCCESS === Job ${job.id}, TotalRows: ${totalRows}`);

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
    console.error(`[createCsvImportJobService] === FAILED === Tenant: ${tenantId}`, error);
    throw error;
  }
};

/**
 * Get the status of a specific CSV Import Job.
 */
export const getCsvImportJobStatusService = async (jobId) => {
  console.log(`[getCsvImportJobStatusService] Fetching status for job: ${jobId}`);

  try {
    const job = await prisma.csvImportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      console.error(`[getCsvImportJobStatusService] Job not found: ${jobId}`);
      throw new Error("Job not found");
    }

    console.log(`[getCsvImportJobStatusService] Job ${jobId} found, status: ${job.status}`);
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
    console.error(`[getCsvImportJobStatusService] FAILED for job ${jobId}:`, error);
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
  console.log(`[listCsvImportJobsService] Listing jobs - Tenant: ${tenantId}, Status: ${status}`);

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
      })),
      nextCursor,
    };
  } catch (error) {
    console.error(`[listCsvImportJobsService] FAILED to list jobs:`, error);
    throw error;
  }
};

// Function to validate row data
const validateRowData = (row, rawData) => {
  const errors = [];
  console.log(`[validateRowData] Validating row ${row.rowNumber}`);

  try {
    if (typeof rawData !== "object" || rawData === null || Array.isArray(rawData)) {
      const error = `Row ${row.rowNumber} has invalid data format. Expected an object.`;
      console.error(`[validateRowData] ${error}`);
      errors.push(error);
      return errors;
    }

    const {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      linkedInUrl,
      companySize,
    } = rawData;

    // Validate companyName
    if (typeof companyName !== "string" || companyName.trim() === "") {
      errors.push(`Row ${row.rowNumber}: Invalid company name.`);
    }

    // Validate contactName
    if (typeof contactName !== "string" || /\d/.test(contactName)) {
      errors.push(`Row ${row.rowNumber}: Contact name contains invalid characters or numbers.`);
    }

    // Validate contactEmail
    if (typeof contactEmail !== "string" || !contactEmail.includes("@")) {
      errors.push(`Row ${row.rowNumber}: Invalid email format.`);
    }

    // Optional: Validate contactPhone
    if (contactPhone && (typeof contactPhone !== "string" || !/^[\d\-\+\s]+$/.test(contactPhone))) {
      errors.push(`Row ${row.rowNumber}: Invalid phone number format.`);
    }

    // Optional: Validate linkedInUrl
    if (linkedInUrl && (typeof linkedInUrl !== "string" || !linkedInUrl.startsWith("https://www.linkedin.com/"))) {
      errors.push(`Row ${row.rowNumber}: Invalid LinkedIn URL.`);
    }

    // Optional: Validate companySize
    if (companySize && isNaN(parseInt(companySize, 10))) {
      errors.push(`Row ${row.rowNumber}: Invalid company size.`);
    }

    if (errors.length > 0) {
      console.warn(`[validateRowData] Row ${row.rowNumber} validation failed: ${errors.join("; ")}`);
    } else {
      console.log(`[validateRowData] Row ${row.rowNumber} validation passed`);
    }

    return errors;
  } catch (error) {
    console.error(`[validateRowData] Exception validating row ${row.rowNumber}:`, error);
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
      console.log(`[processCsvImportJob] Skipping batch for job ${jobId}, job not in correct state`);
      return;
    }
    console.log(`[processCsvImportJob] Processing job ${jobId}, Status: ${job.status}`);

    const rows = await fetchQueuedRows(jobId, batchSize);
    console.log(`[processCsvImportJob] Fetched ${rows.length} QUEUED rows`);

    if (rows.length === 0) {
      try {
        await prisma.csvImportJob.update({
          where: { id: jobId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        console.log(`[processCsvImportJob] === COMPLETED === Job ${jobId} marked as COMPLETED`);
      } catch (updateError) {
        console.error(`[processCsvImportJob] Failed to mark job ${jobId} as COMPLETED:`, updateError);
      }
      return;
    }

    let processedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      try {
        console.log(`[processCsvImportJob] Processing row ${row.rowNumber} (ID: ${row.id})`);
        const result = await processRow(row, job, job.dedupePolicy, job.importMode);
        
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
        console.error(`[processCsvImportJob] CRITICAL: Row ${row.rowNumber} processing failed:`, error);
        
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
          console.error(`[processCsvImportJob] Failed to update row ${row.id} status:`, updateError);
        }
      }
    }

    try {
      await updateJobCounters(jobId, processedCount, duplicateCount, failedCount);
      console.log(`[processCsvImportJob] Batch complete - Processed: ${processedCount}, Duplicates: ${duplicateCount}, Failed: ${failedCount}`);
    } catch (counterError) {
      console.error(`[processCsvImportJob] Failed to update job counters:`, counterError);
    }

    console.log(`[processCsvImportJob] Re-queuing job ${jobId} for next batch`);
    setImmediate(() => processCsvImportJob(jobId));
  } catch (error) {
    console.error(`[processCsvImportJob] === CRITICAL ERROR === JobId: ${jobId}`, error);
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
      console.warn(`[fetchJobDetails] Job ${jobId} not in PROCESSING state (status: ${job.status})`);
      
      if (job.status === "QUEUED") {
        const retryLimit = parseInt(process.env.RETRY_COUNT_MAX_LIMIT || "5", 10);
        
        if (job.retryCount >= retryLimit) {
          try {
            await prisma.csvImportJob.update({
              where: { id: jobId },
              data: { status: "FAILED", completedAt: new Date() },
            });
            console.error(`[fetchJobDetails] Job ${jobId} marked as FAILED - Retry limit (${retryLimit}) reached`);
          } catch (updateError) {
            console.error(`[fetchJobDetails] Failed to mark job ${jobId} as FAILED:`, updateError);
          }
          return null;
        }

        try {
          await prisma.csvImportJob.update({
            where: { id: jobId },
            data: { retryCount: job.retryCount + 1, status: "QUEUED" },
          });
          console.log(`[fetchJobDetails] Job ${jobId} re-queued (retry ${job.retryCount + 1})`);
        } catch (updateError) {
          console.error(`[fetchJobDetails] Failed to re-queue job ${jobId}:`, updateError);
        }
        return null;
      } else {
        console.log(`[fetchJobDetails] Skipping job ${jobId} (status: ${job.status})`);
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
    console.error(`[fetchJobCounters] Error fetching counters for job ${jobId}:`, error);
    throw error;
  }
};

// Helper function to fetch queued rows
const fetchQueuedRows = async (jobId, batchSize) => {
  console.log(`[fetchQueuedRows] Fetching up to ${batchSize} QUEUED rows for job ${jobId}`);
  
  try {
    const rows = await prisma.csvImportRow.findMany({
      where: { jobId, status: "QUEUED" },
      orderBy: { rowNumber: "asc" },
      take: batchSize,
    });
    console.log(`[fetchQueuedRows] Found ${rows.length} QUEUED rows`);
    return rows;
  } catch (error) {
    console.error(`[fetchQueuedRows] Error fetching rows for job ${jobId}:`, error);
    throw error;
  }
};

// Helper function to process a single row
const processRow = async (row, job, dedupePolicy, importMode) => {
  console.log(`[processRow] === START === Row ${row.rowNumber} (ID: ${row.id}), Job: ${job.id}`);
  
  try {
    const rawData = row.rawData;

    // Validate row data
    const validationErrors = validateRowData(row, rawData);
    if (validationErrors.length > 0) {
      const errorString = validationErrors.join("; ");
      console.warn(`[processRow] Validation FAILED for row ${row.rowNumber}: ${errorString}`);
      
      try {
        await prisma.csvImportRow.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            error: errorString,
          },
        });
      } catch (updateError) {
        console.error(`[processRow] Failed to update row ${row.id} with validation errors:`, updateError);
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
    const email = normalizeEmail(mappedFields.contactEmail);
    const phone = normalizePhone(mappedFields.contactPhone);
    const domainPlusName = deriveDomainPlusName(email, mappedFields.companyName);
    const normalizedLinkedInUrl = canonicalizeLinkedInUrl(mappedFields.linkedInUrl);

    console.log(`[processRow] Normalized - Email: ${email}, Phone: ${phone}, LinkedIn: ${normalizedLinkedInUrl}`);

    const contactEmailArray = email ? [email] : [];

    // Deduplication logic
    console.log(`[processRow] Checking for duplicates using policy: ${dedupePolicy}`);
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
      console.log(`[processRow] Found existing lead (ID: ${existingLead.id}) using ${dedupePolicy}`);
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
        console.error(`[processRow] Failed to mark row ${row.id} as SKIPPED:`, updateError);
      }
      return { status: "SKIPPED" };
      
    } else if (importMode === "INSERT_ONLY") {
      if (existingLead) {
        console.log(`[processRow] INSERT_ONLY: Duplicate found (Lead ID: ${existingLead.id}), marking as DUPLICATE`);
        try {
          await prisma.csvImportRow.update({
            where: { id: row.id },
            data: { status: "DUPLICATE", processedAt: new Date() },
          });
        } catch (updateError) {
          console.error(`[processRow] Failed to mark row ${row.id} as DUPLICATE:`, updateError);
        }
        return { status: "DUPLICATE" };
      } else {
        console.log(`[processRow] INSERT_ONLY: Creating new lead`);
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
          
          console.log(`[processRow] INSERT_ONLY: Created new lead (ID: ${newLead.id})`);
          return { status: "PROCESSED" };
        } catch (error) {
          if (error.code === "P2002") {
            console.warn(`[processRow] INSERT_ONLY: Race condition duplicate (P2002)`);
            try {
              await prisma.csvImportRow.update({
                where: { id: row.id },
                data: { status: "DUPLICATE", processedAt: new Date() },
              });
            } catch (updateError) {
              console.error(`[processRow] Failed to mark row ${row.id} as DUPLICATE after P2002:`, updateError);
            }
            return { status: "DUPLICATE" };
          } else {
            console.error(`[processRow] INSERT_ONLY: Failed to create lead:`, error);
            throw error;
          }
        }
      }
      
    } else if (importMode === "UPSERT") {
      if (existingLead) {
        console.log(`[processRow] UPSERT: Updating existing lead (ID: ${existingLead.id})`);
        try {
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
          
          console.log(`[processRow] UPSERT: Updated lead (ID: ${existingLead.id})`);
          return { status: "PROCESSED" };
        } catch (updateError) {
          console.error(`[processRow] UPSERT: Failed to update lead ${existingLead.id}:`, updateError);
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
          
          console.log(`[processRow] UPSERT: Created new lead (ID: ${newLead.id})`);
          return { status: "PROCESSED" };
        } catch (error) {
          if (error.code === "P2002") {
            console.warn(`[processRow] UPSERT: Race condition duplicate (P2002)`);
            try {
              await prisma.csvImportRow.update({
                where: { id: row.id },
                data: { status: "DUPLICATE", processedAt: new Date() },
              });
            } catch (updateError) {
              console.error(`[processRow] Failed to mark row ${row.id} as DUPLICATE after P2002:`, updateError);
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
    console.error(`[processRow] === FAILED === Row ${row.rowNumber} (ID: ${row.id})`, error);
    throw error;
  }
};

// Helper function to update job counters
const updateJobCounters = async (jobId, processedCount, duplicateCount, failedCount) => {
  console.log(`[updateJobCounters] Updating job ${jobId} - Processed: +${processedCount}, Duplicates: +${duplicateCount}, Failed: +${failedCount}`);
  
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
    
    console.log(`[updateJobCounters] Job ${jobId} counters updated successfully`);
  } catch (error) {
    console.error(`[updateJobCounters] FAILED to update counters for job ${jobId}:`, error);
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

        console.log(`[processCsvJobs] Starting async processing for job ${job.id}`);
        processCsvImportJob(job.id);
      } catch (jobUpdateError) {
        console.error(`[processCsvJobs] FAILED to update status for job ${job.id}:`, jobUpdateError);
      }
    }
    
    console.log("[processCsvJobs] === WORKER COMPLETE === All jobs queued for processing");
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
    
    console.log(`[getObjectStreamCSV] S3 params - Bucket: ${params.Bucket}, Key: ${params.Key}`);
    const response = await s3.send(new GetObjectCommand(params));
    console.log(`[getObjectStreamCSV] S3 object retrieved successfully`);
    return response.Body;
  } catch (error) {
    console.error(`[getObjectStreamCSV] FAILED to get object ${objectKey} from S3:`, error);
    throw error;
  }
}