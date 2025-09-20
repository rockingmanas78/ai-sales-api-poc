import { Router } from "express";
import {
  createLead,
  getTenantLeads,
  getLeadsByJobId,
  getLeadById,
  updateLead,
  deleteLead,
  updateLeadStatus,
  getDashboardLeads,
  bulkDeleteLeads,
  bulkUpdateLeadStatus,
  bulkUploadLeadsFromUrl,
} from "../controllers/lead.controller.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
const leadRouter = Router();
//ROUTE FOR BULK UPLOADING VIA URL
leadRouter.post(
  "/bulk-upload", verifyToken(), authorize("manage_leads"), bulkUploadLeadsFromUrl // This controller now expects a JSON body with a 'fileUrl'
);

// Create a new lead (manual upload)
leadRouter.post("/", verifyToken(), authorize("manage_leads"), createLead);

// Get all leads by job id
leadRouter.get(
  "/by-job/:jobId", verifyToken(), authorize("view_leads"), getLeadsByJobId);

// Get all leads
leadRouter.get(
  "/tenant/:tenantId", verifyToken(), authorize("view_leads"), getTenantLeads);
// Get single lead
leadRouter.get("/lead/:leadId", verifyToken(), authorize("view_leads"), getLeadById);
// Update lead details
leadRouter.put("/:leadId", verifyToken(), authorize("manage_leads"), updateLead);
// Delete lead
leadRouter.delete("/:leadId", verifyToken(), authorize("manage_leads"), deleteLead);
// Update lead status only
leadRouter.patch("/:leadId/status", verifyToken(), authorize("manage_leads"), updateLeadStatus);

//dashboard leads
leadRouter.get("/dashboard/leads", verifyToken(), authorize("view_leads"), getDashboardLeads);
leadRouter.post("/leads/bulk-delete", verifyToken(), authorize("manage_leads"), bulkDeleteLeads);
leadRouter.patch("/leads/bulk-status", verifyToken(), authorize("manage_leads"), bulkUpdateLeadStatus);

export default leadRouter;
