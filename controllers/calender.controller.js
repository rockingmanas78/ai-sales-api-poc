import * as calendarService from "../services/calender.service.js";

export const initiateConnect = (req, res) => {
  try {
    const authUrl = calendarService.generateAuthUrl();
    res.status(200).json({
      success: true,
      authUrl,
      message: "Redirect to this URL to authorize Google Calendar connection.",
    });
  } catch (error) {
    console.error("Error initiating connection:", error);
    res.status(500).json({ error: "Failed to initiate connection." });
  }
};

export const handleCallback = async (req, res) => {
  console.log("Received callback with query:", req.query);
  const code = req.query.code;
  const tenantId = req.query.tenantId;
  const userId = req.query.userId;

  if (!code || !tenantId || !userId) {
    return res.status(400).json({
      error: "Missing authorization code, tenantId, or userId.",
    });
  }

  try {
    const connection = await calendarService.saveConnection(
      tenantId,
      userId,
      code
    );

    // After successful connection, you might redirect them to a success page
    res.status(200).json({
      success: true,
      message: "Google Calendar connected successfully.",
      connectionId: connection.id,
    });
  } catch (error) {
    console.error("Error handling Google callback:", error.message);
    res.status(500).json({
      error: "Failed to connect calendar. Please try again.",
    });
  }
};

export const getConnectionStatus = async (req, res) => {
  const userId = req.user?.id;
  const tenantId = req.user?.tenantId;

  if (!userId || !tenantId) {
    return res.status(400).json({
      error: "Missing userId or tenantId.",
    });
  }

  try {
    const connection = await calendarService.getConnectionStatus(
      userId,
      tenantId
    );

    if (!connection) {
      return res.status(404).json({
        error: "No calendar connection found for this user.",
      });
    }

    return res.status(200).json({
      connection,
    });
  } catch (error) {
    console.error(
      "Error handling Google callback:",
      error.error || error.message
    );

    return res.status(500).json({
      error: "Failed to connect calendar. Please try again.",
    });
  }
};

export const viewEvents = async (req, res) => {
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  const { start, end } = req.query; // start and end are expected as ISO strings

  if (!tenantId || !userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const timeMin = start ? new Date(start) : undefined;
    const timeMax = end ? new Date(end) : undefined;

    // Basic date validation
    if ((start && isNaN(timeMin)) || (end && isNaN(timeMax))) {
      return res
        .status(400)
        .json({ error: "Invalid start or end date format." });
    }

    const events = await calendarService.getEvents(
      tenantId,
      userId,
      timeMin,
      timeMax
    );
    res.status(200).json({ success: true, events });
  } catch (error) {
    console.error("Error viewing calendar events:", error.message);
    const status = error.message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const addEvent = async (req, res) => {
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  const eventDetails = req.body;

  console.log("Data recieved is: ", req.body, req.user);

  if (!tenantId || !userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  // Basic validation for required event fields
  if (!eventDetails.summary || !eventDetails.start || !eventDetails.end) {
    return res.status(400).json({
      error: "Event summary, start time, and end time are required.",
    });
  }

  try {
    const newEvent = await calendarService.addEvent(
      tenantId,
      userId,
      eventDetails
    );
    res.status(201).json({
      success: true,
      message: "Event created successfully.",
      event: newEvent,
    });
  } catch (error) {
    console.error("Error adding event:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const editEvent = async (req, res) => {
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  const { eventId } = req.params;
  const eventDetails = req.body;

  if (!tenantId || !userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (!eventId) {
    return res.status(400).json({ error: "Event ID is required." });
  }
  if (Object.keys(eventDetails).length === 0) {
    return res.status(400).json({ error: "No update details provided." });
  }

  try {
    const updatedEvent = await calendarService.editEvent(
      tenantId,
      userId,
      eventId,
      eventDetails
    );
    res.status(200).json({
      success: true,
      message: "Event updated successfully.",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Error editing event:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const deleteEvent = async (req, res) => {
  const tenantId = req.user?.tenantId;
  const userId = req.user?.id;
  const { eventId } = req.params;

  if (!tenantId || !userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  if (!eventId) {
    return res.status(400).json({ error: "Event ID is required." });
  }

  try {
    await calendarService.deleteEvent(tenantId, userId, eventId);
    res.status(200).json({
      success: true,
      message: "Event deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting event:", error.message);
    res.status(500).json({ error: error.message });
  }
};
