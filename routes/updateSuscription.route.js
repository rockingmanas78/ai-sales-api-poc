import express from "express";
//import auth from "../middleware/auth.js";
import { updateSubscription } from "../controllers/updateSuscription.js";
import verifyToken from "../middlewares/verifyToken.js";
import authorize from "../middlewares/rbac.js";

const router = express.Router();
//auth.optional
router.patch("/update", verifyToken(), authorize("manage_tenant"), updateSubscription);

export default router;


