import express from "express";
import {
  generatePresignedUrl,
  recordUploadedDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  softDeleteDocument,
} from "../controllers/knowledgeDocument.controller.js";

import { verifyToken } from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";

const router = express.Router();

//Generate presigned S3 URL
router.post(
  "/presign",
  verifyToken(),
  authorize("manage_documents"),
  generatePresignedUrl
);

//Record uploaded document metadata
router.post(
  "/",
  verifyToken(),
  authorize("manage_documents"),
  recordUploadedDocument
);

//List documents (with optional ?status= filter)
router.get("/", verifyToken(), authorize("view_documents"), listDocuments);

//Get one document metadata/status
router.get("/:id", verifyToken(), authorize("view_documents"), getDocumentById);

//Update document metadata or cancel processing
router.put(
  "/:id",
  verifyToken(),
  authorize("manage_documents"),
  updateDocument
);

//Soft-delete a document
router.delete(
  "/:id",
  verifyToken(),
  authorize("manage_documents"),
  softDeleteDocument
);

export default router;
