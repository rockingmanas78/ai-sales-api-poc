// src/routes/emailVerification.route.js
import { Router } from "express";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";
import {
  verifySingleEmailController,
  verifyEmailsBulkController,
  verifyLeadsBulkController,
} from "../controllers/emailVerification.controller.js";
import { verifyCampaignRecipientsController } from "../controllers/emailVerificationCampaign.controller.js";

const router = Router();

router.post(
  "/check",
  verifyToken(),
  authorize("manage_emails"),
  verifySingleEmailController
);

router.post(
  "/bulk",
  verifyToken(),
  authorize("manage_emails"),
  verifyEmailsBulkController
);

router.post(
  "/leads",
  verifyToken(),
  authorize("manage_emails"),
  verifyLeadsBulkController
);

router.post(
  "/campaign/:campaignId/verify-recipients",
  verifyToken(),
  authorize("manage_emails"),
  verifyCampaignRecipientsController
);

export default router;



// import { Router } from "express";
// import verifyToken from "../middlewares/verifyToken.js";
// import authorize from "../middlewares/rbac.js";
// import {
//   verifySingleEmailController,
//   verifyEmailsBulkController,
//   verifyLeadsBulkController,
// } from "../controllers/emailVerification.controller.js";
// import { verifyCampaignRecipientsController } from "../controllers/emailVerificationCampaign.controller.js";

// const router = Router();

// /**
//  * POST /api/email-verification/check
//  * Body: { email: string }
//  */
// router.post(
//   "/check",
//   verifyToken(),
//   authorize("manage_emails"),
//   verifySingleEmailController
// );

// /**
//  * POST /api/email-verification/bulk
//  * Body: { emails: string[], maxBatchSize?: number }
//  * (maxBatchSize is just for front-end info; backend will hard-limit)
//  */
// router.post(
//   "/bulk",
//   verifyToken(),
//   authorize("manage_emails"),
//   verifyEmailsBulkController
// );

// /**
//  * POST /api/email-verification/leads
//  * Body: { leadIds: string[], maxBatchSize?: number }
//  * Reads primary email from each Lead and verifies.
//  */
// router.post(
//   "/leads",
//   verifyToken(),
//   authorize("manage_emails"),
//   verifyLeadsBulkController
// );

// router.post(
//   "/campaign/:campaignId/verify-recipients",
//   verifyToken(),
//   authorize("manage_emails"),
//   verifyCampaignRecipientsController
// );

// export default router;
