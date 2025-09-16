// routes/events.route.js
import { Router } from "express";
import ingestSingleEvent from "../controllers/ingestSingle.controller.js";
import ingestBatchEvents from "../controllers/ingestBatch.controller.js";
import {
  listEvents,
  tenantEventList,
} from "../controllers/listEvents.controller.js";

const router = Router();

//for single event
router.post("/single", ingestSingleEvent);

//for multiple events happening at a login
router.post("/batch", ingestBatchEvents);

//to check the list of the events happening
router.get("/all", listEvents);

router.get("/events-list", tenantEventList);

export default router;
