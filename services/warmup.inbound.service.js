import { PrismaClient } from "@prisma/client";
import axios from "axios";
import {
  safeLowercaseEmail,
  extractPlusTokenFromEmails,
  parseWarmupToken,
} from "./warmup.utils.service.js";
import { sendRawEmailWithHeaders } from "./ses.service.js";

const prisma = new PrismaClient();

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/* ---------------- helpers ---------------- */

function asArray(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function extractEmails(input) {
  const out = [];
  for (const item of asArray(input)) {
    if (typeof item !== "string") continue;
    const matches = item.match(EMAIL_REGEX);
    if (matches) out.push(...matches);
  }
  return [...new Set(out.map(safeLowercaseEmail))];
}

function cleanMessageId(value) {
  if (!value) return null;
  let v = Array.isArray(value) ? value[value.length - 1] : value;
  v = String(v).trim();
  if (v.startsWith("<") && v.endsWith(">")) v = v.slice(1, -1);
  return v || null;
}

function stripHtml(html) {
  return html
    ? String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

/* ---------------- AI reply ---------------- */

async function generateWarmupReplyText({ latestEmailText }) {
  const fallback = "Got it — thanks for the update!";
  const endpoint = process.env.AI_SERVICE_ENDPOINT;
  if (!endpoint) return fallback;

  try {
    const res = await axios.post(
      `${endpoint}/api/email/warmup-reply`,
      { latest_email: latestEmailText || "" },
      {
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.WEBHOOK_SECRET,
        },
        timeout: 10_000,
      }
    );
    return res?.data?.reply || res?.data?.text || fallback;
  } catch {
    return fallback;
  }
}

/* =========================================================
   ENTRY POINT
========================================================= */

export async function processWarmupInboundEvent(eventPayload) {
  console.log("Inb")
  const toEmails = extractEmails(eventPayload.to);
  const fromEmails = extractEmails(eventPayload.from);
  const headers = eventPayload.headers || {};

  if (!toEmails.length || !fromEmails.length) return;

  const normalizedTo = toEmails.map(safeLowercaseEmail);
  const normalizedFrom = fromEmails.map(safeLowercaseEmail);

  // A) inbound to warmup inbox
  const warmupInbox = await prisma.warmupInbox.findFirst({
    where: { email: normalizedTo[0], status: "ACTIVE" },
  });

  if (warmupInbox) {
    await handleInboundToWarmupInbox({
      warmupInbox,
      normalizedTo,
      normalizedFrom,
      headers,
      eventPayload,
    });
    return;
  }

  // B) inbound to reply domain
  await handleInboundToReplyDomain({
    normalizedTo,
    normalizedFrom,
    headers,
    eventPayload,
  });
}

/* =========================================================
   A) INBOUND → WARMUP INBOX
========================================================= */

async function handleInboundToWarmupInbox({
  warmupInbox,
  normalizedTo,
  normalizedFrom,
  headers,
  eventPayload,
}) {
  const warmupFlag = headers["x-sf-warmup"] || headers["X-SF-Warmup"];
  const replyToHeader = headers["reply-to"] || headers["Reply-To"];
  if (!warmupFlag && !replyToHeader) return;

  const replyToEmails = extractEmails(replyToHeader || "");
  const plusToken = extractPlusTokenFromEmails(replyToEmails);
  const parsed = parseWarmupToken(plusToken);
  if (!parsed?.tenantId || !parsed?.warmupUuid) return;

  const tenantId = parsed.tenantId;
  const threadKey = plusToken;

  const providerMessageId =
    eventPayload.providerMessageId ||
    eventPayload?.s3?.objectKey ||
    cleanMessageId(headers["Message-ID"] || headers["message-id"]);

  if (!providerMessageId) return;

  /* Idempotency */
  const snsMessageId = eventPayload.snsMessageId || `warmup-in-${providerMessageId}`;
  const existingEvent = await prisma.warmupMessageEvent.findFirst({
    where: { snsMessageId },
  });
  if (existingEvent) return;

  /* Resolve thread */
  const thread = await prisma.warmupThread.findFirst({
    where: { tenantId, threadKey },
  });
  if (!thread) return;

  /* Save inbound message */
  const inboundMessage = await prisma.warmupMessage.create({
    data: {
      tenantId,
      threadId: thread.id,
      direction: "INBOUND",
      provider: "AWS_SES",
      providerMessageId,
      subject: eventPayload.subject || null,
      from: normalizedFrom,
      to: normalizedTo,
      text: eventPayload.replyText || eventPayload.fullText || null,
      html: eventPayload.html || null,
      headers,
      warmupMarker: threadKey,
      receivedAt: new Date(),
    },
  });

  /* Log event */
  await prisma.warmupMessageEvent.create({
    data: {
      tenantId,
      warmupMessageId: inboundMessage.id,
      providerMessageId,
      eventType: "RECEIVED",
      occurredAt: new Date(),
      snsMessageId,
      payload: eventPayload,
    },
  });

  /* Auto reply */
  if (!warmupInbox.autoEngagementEnabled) return;
  if (headers["X-SF-Warmup-Auto"] || headers["x-sf-warmup-auto"]) return;

  const plainText =
    eventPayload.replyText?.trim() ||
    stripHtml(eventPayload.html || eventPayload.fullText);

  const replyText = await generateWarmupReplyText({ latestEmailText: plainText });

  const inReplyTo = cleanMessageId(headers["Message-ID"] || headers["message-id"]);

  await sendRawEmailWithHeaders({
    fromEmail: warmupInbox.email,
    toEmail: normalizedFrom[0],
    subject: eventPayload.subject ? `Re: ${eventPayload.subject}` : "Re:",
    htmlBody: `<p>${replyText}</p>`,
    replyTo: replyToEmails?.[0],
    extraHeaders: {
      ...(inReplyTo ? { "In-Reply-To": `<${inReplyTo}>` } : {}),
      "X-SF-Warmup": "1",
      "X-SF-Warmup-Auto": "1",
    },
    configurationSetName: process.env.SES_WARMUP_CONFIGURATION_SET,
    messageTags: [
      { Name: "tenantId", Value: tenantId },
      { Name: "isWarmup", Value: "1" },
      { Name: "warmupMarker", Value: threadKey },
    ],
  });
}

/* =========================================================
   B) INBOUND → REPLY DOMAIN
========================================================= */

async function handleInboundToReplyDomain({
  normalizedTo,
  normalizedFrom,
  headers,
  eventPayload,
}) {
  const plusToken = extractPlusTokenFromEmails(normalizedTo);
  const parsed = parseWarmupToken(plusToken);
  if (!parsed?.tenantId) return;

  const tenantId = parsed.tenantId;
  const threadKey = plusToken;

  const providerMessageId =
    eventPayload.providerMessageId ||
    eventPayload?.s3?.objectKey ||
    cleanMessageId(headers["Message-ID"] || headers["message-id"]);

  if (!providerMessageId) return;

  const thread = await prisma.warmupThread.findFirst({
    where: { tenantId, threadKey },
  });
  if (!thread) return;

  await prisma.warmupMessage.create({
    data: {
      tenantId,
      threadId: thread.id,
      direction: "INBOUND",
      provider: "AWS_SES",
      providerMessageId,
      subject: eventPayload.subject || null,
      from: normalizedFrom,
      to: normalizedTo,
      text: eventPayload.replyText || eventPayload.fullText || null,
      html: eventPayload.html || null,
      headers,
      warmupMarker: threadKey,
      receivedAt: new Date(),
    },
  });
}
