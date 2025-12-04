import express from "express";
import {
  initiateConnect,
  handleCallback,
  getConnectionStatus,
  viewEvents,
  addEvent,
  editEvent,
  deleteEvent,
} from "../controllers/calender.controller.js";
import verifyToken from "../middlewares/verifyToken.js";

const router = express.Router();
router.get("/connect", verifyToken(), initiateConnect);
router.get("/connect/callback", verifyToken(), handleCallback);
router.get("/status", verifyToken(), getConnectionStatus);
router.get("/events", verifyToken(), viewEvents);
router.post("/events", verifyToken(), addEvent);
router.put("/events/:eventId", verifyToken(), editEvent);
router.delete("/events/:eventId", verifyToken(), deleteEvent);

export default router;
