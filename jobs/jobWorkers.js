import { processNextBatch } from "../controllers/bulkEmail.controller.js";
import { processCsvJobs } from "../services/csvImport.service.js";

// Worker to process bulk email batches every 60 seconds
export const startBulkEmailWorker = () => {
  setInterval(async () => {
    try {
      await processNextBatch();
    } catch (err) {
      console.error("Error in batch processor:", err);
      // swallow so the loop keeps running
    }
  }, 60_000); // Run every 60 seconds
};

// Worker to process CSV import jobs every 30 seconds
export const startCsvJobWorker = () => {
  setInterval(async () => {
    try {
      console.log("Worker: Checking for jobs to process");

      // Call the function from csvImport.service.js
      await processCsvJobs();
    } catch (error) {
      console.error("Worker: Error processing jobs:", error);
    }
  }, 30 * 1000); // Run every 30 seconds
};
