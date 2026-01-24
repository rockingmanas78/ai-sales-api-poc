import { processNextBatch } from "../controllers/bulkEmail.controller.js";
import { processCsvJobs } from "../services/csvImport.service.js";
// NEW IMPORTS
import { runWarmupSchedulerTick } from "../services/warmup.scheduler.service.js";
import { runWarmupSenderTick } from "../services/warmup.sender.service.js";

// Worker to process bulk email batches every 60 seconds
export const startBulkEmailWorker = () => {
  setInterval(async () => {
    try {
      await processNextBatch();
    } catch (err) {
      console.error("Error in batch processor:", err);
    }
  }, 60_000); 
};

// Worker to process CSV import jobs every 30 seconds
export const startCsvJobWorker = () => {
  setInterval(async () => {
    try {
      // console.log("Worker: Checking for jobs to process");
      await processCsvJobs();
    } catch (error) {
      console.error("Worker: Error processing jobs:", error);
    }
  }, 30 * 1000); 
};

// --- NEW WARMUP WORKERS ---

// 1. THE BRAIN: Generates Drafts & Handles Ramp-up
// Runs every 15 minutes (15 * 60 * 1000 ms)
export const startWarmupSchedulerWorker = () => {
  console.log("[WarmupWorker] 🧠 Scheduler worker started (Every 15m)");
  
  // Run immediately on startup so we don't wait 15 mins for first batch
  runWarmupSchedulerTick().catch(e => console.error(e));

  setInterval(async () => {
    try {
      const result = await runWarmupSchedulerTick();
      if (!result.skipped) {
        console.log(`[WarmupWorker] 🧠 Created ${result.totalDraftsCreated} drafts.`);
      }
    } catch (err) {
      console.error("[WarmupWorker] 🧠 Scheduler Failed:", err);
    }
  }, 15 * 60 * 1000); 
};

// 2. THE MUSCLE: Sends the Emails
// Runs every 1 minute to flush the queue
export const startWarmupSenderWorker = () => {
  console.log("[WarmupWorker] 🚀 Sender worker started (Every 60s)");
  
  setInterval(async () => {
    try {
      const result = await runWarmupSenderTick();
      if (result.sent > 0) {
        console.log(`[WarmupWorker] 🚀 Sent ${result.sent} emails.`);
      }
    } catch (err) {
      console.error("[WarmupWorker] 🚀 Sender Failed:", err);
    }
  }, 60_000);
};