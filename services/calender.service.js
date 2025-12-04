import { google } from "googleapis";

import { PrismaClient, CalendarProvider } from "@prisma/client";

const prisma = new PrismaClient();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID";
const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || "YOUR_CLIENT_SECRET";
const GOOGLE_CALENDAR_REDIRECT_URI =
  process.env.GOOGLE_CALENDAR_REDIRECT_URI || "YOUR_REDIRECT_URI";

const getGoogleAuthClient = () => {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_CALENDAR_REDIRECT_URI
  );
};

const refreshAccessToken = async (connection, auth) => {
  try {
    auth.setCredentials({ refresh_token: connection.refreshToken });

    const tokenResponse = await auth.refreshAccessToken();
    const newAccessToken = tokenResponse.credentials.access_token;
    const newExpiresAt = tokenResponse.credentials.expiry_date
      ? new Date(tokenResponse.credentials.expiry_date)
      : null;

    // Update the database with the new token details
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: newAccessToken,
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      },
    });

    return newAccessToken;
  } catch (err) {
    console.error(
      "[refreshAccessToken] Failed to refresh access token:",
      err?.message || err
    );
    throw err;
  }
};

export const getCalendarClient = async (tenantId, userId) => {
  try {
    const connection = await prisma.calendarConnection.findUnique({
      where: {
        tenantId_userId_provider: {
          tenantId,
          userId,
          provider: CalendarProvider.GOOGLE,
        },
      },
    });

    if (!connection || !connection.refreshToken) {
      throw new Error("Calendar connection not found or unauthorized.");
    }

    const auth = getGoogleAuthClient();
    let accessToken = connection.accessToken;

    // Check if token is expired (giving a 5-minute buffer)
    const isExpired =
      connection.expiresAt &&
      connection.expiresAt.getTime() < Date.now() - 5 * 60 * 1000;

    if (isExpired) {
      console.log(`Token for user ${userId} expired. Refreshing...`);
      accessToken = await refreshAccessToken(connection, auth);
    }

    auth.setCredentials({
      access_token: accessToken,
      refresh_token: connection.refreshToken,
      expiry_date: connection.expiresAt
        ? connection.expiresAt.getTime()
        : undefined,
    });

    // Return the Google Calendar client instance
    return {
      client: google.calendar({ version: "v3", auth }),
      email: connection.accountEmail,
    };
  } catch (err) {
    console.error(
      "[getCalendarClient] Error creating calendar client:",
      err?.message || err
    );
    throw err;
  }
};

export const generateAuthUrl = () => {
  try {
    const auth = getGoogleAuthClient();
    const scopes = [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    return auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
    });
  } catch (err) {
    console.error(
      "[generateAuthUrl] Failed to generate auth URL:",
      err?.message || err
    );
    throw err;
  }
};

export const saveConnection = async (tenantId, userId, code) => {
  try {
    console.log("Saving calendar connection for:", { tenantId, userId });

    const auth = getGoogleAuthClient();
    const { tokens } = await auth.getToken(code);

    auth.setCredentials(tokens);

    // Fetch the primary account email
    const oauth2 = google.oauth2({ version: "v2", auth });
    const userInfo = await oauth2.userinfo.get();
    const accountEmail = userInfo.data.email;

    // Save or update the connection in the database
    const connection = await prisma.calendarConnection.upsert({
      where: {
        tenantId_userId_provider: {
          tenantId,
          userId,
          provider: CalendarProvider.GOOGLE,
        },
      },
      update: {
        accountEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        userId,
        provider: CalendarProvider.GOOGLE,
        accountEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope,
      },
    });

    return connection;
  } catch (err) {
    console.error(
      "[saveConnection] Error saving calendar connection:",
      { tenantId, userId },
      err?.message || err
    );
    throw err;
  }
};

export const getConnectionStatus = async (userId, tenantId) => {
  try {
    if (!userId || !tenantId) {
      return { isConnected: false };
    }

    const conn = await prisma.calendarConnection.findUnique({
      where: {
        tenantId_userId_provider: {
          tenantId,
          userId,
          provider: CalendarProvider.GOOGLE,
        },
      },
    });

    if (conn && conn.refreshToken) {
      return {
        isConnected: true,
        accountEmail: conn.accountEmail,
        provider: conn.provider,
        connectionId: conn.id,
      };
    }

    return { isConnected: false };
  } catch (err) {
    console.error(
      "[getConnectionStatus] Error checking connection status:",
      err?.message || err
    );
    throw err;
  }
};

export const getEvents = async (tenantId, userId, timeMin, timeMax) => {
  try {
    const { client, email } = await getCalendarClient(tenantId, userId);

    const response = await client.events.list({
      calendarId: email, // Use the connected user's email as the calendar ID
      timeMin: timeMin?.toISOString(),
      timeMax: timeMax?.toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: "startTime",
    });

    return response.data.items;
  } catch (err) {
    console.error(
      "[getEvents] Failed to fetch calendar events:",
      err?.message || err
    );
    throw err;
  }
};

export const addEvent = async (tenantId, userId, eventDetails) => {
  try {
    const { client, email } = await getCalendarClient(tenantId, userId);

    // Google Calendar API expects `start` and `end` to be objects like
    // { dateTime: '2025-12-05T08:42:00.000Z' } or { date: '2025-12-05' }.
    // Accept flexible input from callers (strings or Date) and normalize.
    const normalizeWhen = (val) => {
      if (!val) return null;
      if (typeof val === "string") return { dateTime: val };
      if (val instanceof Date) return { dateTime: val.toISOString() };
      // Already an object with dateTime/date
      if (typeof val === "object" && (val.dateTime || val.date)) return val;
      return null;
    };

    const resource = { ...eventDetails };
    resource.start = normalizeWhen(eventDetails.start);
    resource.end = normalizeWhen(eventDetails.end);

    if (!resource.start || !resource.end) {
      throw new Error(
        "Missing start or end time in event resource (expected start/end as dateTime or date fields)"
      );
    }

    const response = await client.events.insert({
      calendarId: email,
      resource,
    });

    return response.data;
  } catch (err) {
    console.error(
      "[addEvent] Failed to add calendar event:",
      err?.message || err
    );
    throw err;
  }
};

export const editEvent = async (tenantId, userId, eventId, eventDetails) => {
  try {
    const { client, email } = await getCalendarClient(tenantId, userId);

    const response = await client.events.patch({
      calendarId: email,
      eventId: eventId,
      resource: eventDetails,
    });

    return response.data;
  } catch (err) {
    console.error(
      "[editEvent] Failed to edit calendar event:",
      err?.message || err
    );
    throw err;
  }
};

export const deleteEvent = async (tenantId, userId, eventId) => {
  try {
    const { client, email } = await getCalendarClient(tenantId, userId);

    await client.events.delete({
      calendarId: email,
      eventId: eventId,
    });
  } catch (err) {
    console.error(
      "[deleteEvent] Failed to delete calendar event:",
      err?.message || err
    );
    throw err;
  }
};
