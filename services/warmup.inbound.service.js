// services/warmup.inbound.service.js
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import {
  safeLowercaseEmail,
  extractPlusTokenFromEmails,
  parseWarmupToken,
  getStartOfTodayUtcDateOnly,
} from "./warmup.utils.service.js";
import { sendRawEmailWithHeaders } from "./ses.service.js";

const prisma = new PrismaClient();

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

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

function getHeader(headers, key) {
  const target = String(key || "").toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (String(k || "").toLowerCase() === target) return v;
  }
  return undefined;
}

function hasHeader(headers, key) {
  const v = getHeader(headers, key);
  return v !== undefined && v !== null && String(v).trim() !== "";
}

function findWarmupReplyToAddress(emails) {
  const list = asArray(emails).map(safeLowercaseEmail);
  return list.find((e) => e.startsWith("wreply+")) || null;
}

function stableInboundId(eventPayload, headers) {
  // Lambda payload usually has mail.messageId as providerMessageId.
  // Fallback to s3 pointer or message-id header.
  return (
    eventPayload?.providerMessageId ||
    eventPayload?.messageId ||
    eventPayload?.s3?.objectKey ||
    cleanMessageId(getHeader(headers, "message-id")) ||
    null
  );
}

function getMaxTurnsPerThreadPerDay() {
  const v = Number(process.env.WARMUP_MAX_TURNS_PER_THREAD_PER_DAY || 6);
  return Number.isFinite(v) && v > 0 ? v : 6;
}

/* ---------------- AI reply ---------------- */

async function generateWarmupReplyText({ latestEmailText }) {
  const fallback = "Got it — thanks for the update!";
  const endpoint = process.env.AI_SERVICE_ENDPOINT; // e.g. http://localhost:8000
  const path = process.env.AI_WARMUP_REPLY_PATH || "/api/warmup/reply"; // your curl uses this
  const secret = process.env.AI_INTERNAL_SECRET || process.env.WEBHOOK_SECRET;

  if (!endpoint) return fallback;

  try {
    const res = await axios.post(
      `${endpoint}${path}`,
      { latest_email: latestEmailText || "" },
      {
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        timeout: 10_000,
      }
    );

    const data = res?.data || {};

    // If your AI returns direct fields:
    if (typeof data?.reply === "string" && data.reply.trim()) return data.reply.trim();
    if (typeof data?.text === "string" && data.text.trim()) return data.text.trim();

    // Your shown response: content is a JSON string containing { subject, content }
    if (typeof data?.content === "string") {
      try {
        const parsed = JSON.parse(data.content);
        if (parsed?.content) return String(parsed.content).trim();
      } catch {}
      return data.content.trim();
    }

    return fallback;
  } catch (e) {
    return fallback;
  }
}

/* =========================================================
   ENTRY POINT
========================================================= */

export async function processWarmupInboundEvent(eventPayload) {
  const headers = eventPayload.headers || {};

  const toEmails = extractEmails(eventPayload.to);
  const fromEmails = extractEmails(eventPayload.from);

  if (!toEmails.length || !fromEmails.length) return;

  const normalizedTo = toEmails.map(safeLowercaseEmail);
  const normalizedFrom = fromEmails.map(safeLowercaseEmail);

  // A) inbound to warmup inbox (pool address like inbox-01@warmup.domain)
  const recipientEmail = normalizedTo[0];
  const warmupInbox = await prisma.warmupInbox.findFirst({
    where: { email: recipientEmail, status: "ACTIVE" },
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

  // B) inbound to reply-domain address (wreply+wm.<tenant>.<uuid>@warmup.domain)
  await handleInboundToReplyDomain({
    normalizedTo,
    normalizedFrom,
    headers,
    eventPayload,
  });
}

/* =========================================================
   A) INBOUND → WARMUP INBOX (pool mailbox)
   - This receives the initial warmup email from a profile identity
   - Auto-replies from warmupInbox back to profile (to keep engagement)
   - Reply-To stays wreply+token@warmup.domain so replies stay inside warmup subdomain
========================================================= */

async function handleInboundToWarmupInbox({
  warmupInbox,
  normalizedTo,
  normalizedFrom,
  headers,
  eventPayload,
}) {
  // Accept warmup only if header marker exists OR reply-to contains wreply+
  const warmupFlag = getHeader(headers, "x-sf-warmup");
  const replyToHeader = getHeader(headers, "reply-to");

  if (!warmupFlag && !replyToHeader) return;

  const replyToEmails = extractEmails(String(replyToHeader || ""));
  const plusToken = extractPlusTokenFromEmails(replyToEmails);
  const parsed = parseWarmupToken(plusToken);
  if (!parsed?.tenantId || !parsed?.warmupUuid) return;

  const tenantId = parsed.tenantId;
  const threadKey = plusToken;

  const providerMessageId = stableInboundId(eventPayload, headers);
  if (!providerMessageId) return;

  // Idempotency for inbound: use a stable synthetic snsMessageId
  const snsMessageId = eventPayload.snsMessageId || `warmup-inbox-in:${providerMessageId}`;
  const existingEvent = await prisma.warmupMessageEvent.findFirst({ where: { snsMessageId } });
  if (existingEvent) return;

  const thread = await prisma.warmupThread.findFirst({
    where: { tenantId, threadKey },
    include: {
      EmailWarmupProfile: { include: { EmailIdentity: true } },
    },
  });
  if (!thread) return;

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

  // Optional: increment "replyCount" for the profile identity (this is “someone replied in thread” signal)
  const emailIdentityId = thread?.EmailWarmupProfile?.EmailIdentity?.id;
  if (emailIdentityId) {
    await prisma.warmupDailyStat.updateMany({
      where: { tenantId, emailIdentityId, date: getStartOfTodayUtcDateOnly() },
      data: { replyCount: { increment: 1 } },
    });
  }

  // Auto reply from warmup inbox
  if (!warmupInbox.autoEngagementEnabled) return;
  if (hasHeader(headers, "x-sf-warmup-auto") || hasHeader(headers, "x-sf-warmup-system")) return;

  const plainText =
    (eventPayload.replyText || "").trim() ||
    stripHtml(eventPayload.html || eventPayload.fullText);

  const replyText = await generateWarmupReplyText({ latestEmailText: plainText });

  const inReplyTo = cleanMessageId(getHeader(headers, "message-id"));
  const references = getHeader(headers, "references");
  const replyToAddress = replyToEmails?.[0] || findWarmupReplyToAddress(replyToEmails) || null;

  const sendRes = await sendRawEmailWithHeaders({
    fromEmail: warmupInbox.email,               // must be @warmup.domain
    toEmail: normalizedFrom[0],                 // profile sender
    subject: eventPayload.subject ? `Re: ${eventPayload.subject}` : "Re:",
    htmlBody: `<p>${replyText}</p>`,
    replyTo: replyToAddress,                    // keeps replies inside warmup subdomain
    extraHeaders: {
      ...(inReplyTo ? { "In-Reply-To": `<${inReplyTo}>` } : {}),
      ...(references ? { References: String(references) } : {}),
      "X-SF-Warmup": "1",
      "X-SF-Warmup-Auto": "1",
      "X-SF-Warmup-System": "1",
    },
    configurationSetName: process.env.SES_WARMUP_CONFIGURATION_SET,
    messageTags: [
      { Name: "tenantId", Value: tenantId },
      { Name: "isWarmup", Value: "1" },
      { Name: "warmupMarker", Value: threadKey },
    ],
  });

  const outProviderMessageId = sendRes?.MessageId;

  // Persist outbound auto-reply message (so UI "Recent Activity" makes sense)
  if (outProviderMessageId) {
    const outbound = await prisma.warmupMessage.create({
      data: {
        tenantId,
        threadId: thread.id,
        direction: "OUTBOUND",
        provider: "AWS_SES",
        providerMessageId: outProviderMessageId,
        subject: eventPayload.subject ? `Re: ${eventPayload.subject}` : "Re:",
        from: [warmupInbox.email],
        to: [normalizedFrom[0]],
        html: `<p>${replyText}</p>`,
        headers: {
          "Reply-To": replyToAddress,
          "X-SF-Warmup": "1",
          "X-SF-Warmup-Auto": "1",
          "X-SF-Warmup-System": "1",
        },
        warmupMarker: threadKey,
        configurationSet: process.env.SES_WARMUP_CONFIGURATION_SET,
        sentAt: new Date(),
      },
    });

    await prisma.warmupMessageEvent.create({
      data: {
        tenantId,
        warmupMessageId: outbound.id,
        providerMessageId: outProviderMessageId,
        eventType: "SEND",
        occurredAt: new Date(),
        snsMessageId: `warmup-inbox-out:${outProviderMessageId}`, // unique
        payload: { auto: true, side: "INBOX" },
      },
    });
  }
}

/* =========================================================
   B) INBOUND → REPLY DOMAIN (wreply+token@warmup.domain)
   - This receives replies from warmup inboxes (and keeps everything on warmup subdomain)
   - Then your system sends the next message from the PROFILE back to the warmup inbox
   - This creates the automated back-and-forth warmup loop
========================================================= */

async function handleInboundToReplyDomain({
  normalizedTo,
  normalizedFrom,
  headers,
  eventPayload,
}) {
  const replyAddress = findWarmupReplyToAddress(normalizedTo);
  if (!replyAddress) return;

  const plusToken = extractPlusTokenFromEmails(replyAddress);
  const parsed = parseWarmupToken(plusToken);
  if (!parsed?.tenantId) return;

  const tenantId = parsed.tenantId;
  const threadKey = plusToken;

  const providerMessageId = stableInboundId(eventPayload, headers);
  if (!providerMessageId) return;

  const snsMessageId = eventPayload.snsMessageId || `warmup-reply-in:${providerMessageId}`;
  const existingEvent = await prisma.warmupMessageEvent.findFirst({ where: { snsMessageId } });
  if (existingEvent) return;

  // Pull full thread context (need profile identity + warmup inbox)
  const thread = await prisma.warmupThread.findFirst({
    where: { tenantId, threadKey },
    include: {
      WarmupInbox: true,
      EmailWarmupProfile: { include: { EmailIdentity: true } },
      WarmupMessage: {
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!thread) return;

  // Save inbound message to thread
  const inbound = await prisma.warmupMessage.create({
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

  await prisma.warmupMessageEvent.create({
    data: {
      tenantId,
      warmupMessageId: inbound.id,
      providerMessageId,
      eventType: "RECEIVED",
      occurredAt: new Date(),
      snsMessageId,
      payload: eventPayload,
    },
  });

  // Increment replyCount for the profile identity for today
  const emailIdentityId = thread?.EmailWarmupProfile?.EmailIdentity?.id;
  if (emailIdentityId) {
    await prisma.warmupDailyStat.updateMany({
      where: { tenantId, emailIdentityId, date: getStartOfTodayUtcDateOnly() },
      data: { replyCount: { increment: 1 } },
    });
  }

  // Auto-continue conversation (PROFILE side)
  // Stop loops: if system-generated or profile disabled
  if (hasHeader(headers, "x-sf-warmup-system")) return;
  if (thread?.EmailWarmupProfile?.status !== "ACTIVE") return;
  if (thread?.EmailWarmupProfile?.mode === "OFF") return;

  const warmupInboxEmail = thread?.WarmupInbox?.email;
  const profileEmail = safeLowercaseEmail(thread?.EmailWarmupProfile?.EmailIdentity?.emailAddress || "");

  // If you truly want everything inside warmup subdomain, ensure:
  // - warmupInboxEmail is @warmup.domain
  // - profileEmail can be your sending identity (still ok if not warmup domain)
  if (!warmupInboxEmail || !profileEmail) return;

  // Guard: max turns per day per thread
  const maxTurns = getMaxTurnsPerThreadPerDay();
  const startOfDay = getStartOfTodayUtcDateOnly();
  const turnsToday = await prisma.warmupMessage.count({
    where: { threadId: thread.id, createdAt: { gte: startOfDay } },
  });
  if (turnsToday >= maxTurns) return;

  const plainText =
    (eventPayload.replyText || "").trim() ||
    stripHtml(eventPayload.html || eventPayload.fullText);

  const replyText = await generateWarmupReplyText({ latestEmailText: plainText });

  const inReplyTo = cleanMessageId(getHeader(headers, "message-id"));
  const references = getHeader(headers, "references");

  const sendRes = await sendRawEmailWithHeaders({
    fromEmail: profileEmail,
    toEmail: warmupInboxEmail,
    subject: eventPayload.subject ? `Re: ${eventPayload.subject}` : "Re:",
    htmlBody: `<p>${replyText}</p>`,
    replyTo: replyAddress, // critical: keeps replies landing back on warmup subdomain
    extraHeaders: {
      ...(inReplyTo ? { "In-Reply-To": `<${inReplyTo}>` } : {}),
      ...(references ? { References: String(references) } : {}),
      "X-SF-Warmup": "1",
      "X-SF-Warmup-System": "1",
    },
    configurationSetName: process.env.SES_WARMUP_CONFIGURATION_SET,
    messageTags: [
      { Name: "tenantId", Value: tenantId },
      { Name: "isWarmup", Value: "1" },
      { Name: "warmupMarker", Value: threadKey },
    ],
  });

  const outProviderMessageId = sendRes?.MessageId;
  if (!outProviderMessageId) return;

  const outbound = await prisma.warmupMessage.create({
    data: {
      tenantId,
      threadId: thread.id,
      direction: "OUTBOUND",
      provider: "AWS_SES",
      providerMessageId: outProviderMessageId,
      subject: eventPayload.subject ? `Re: ${eventPayload.subject}` : "Re:",
      from: [profileEmail],
      to: [warmupInboxEmail],
      html: `<p>${replyText}</p>`,
      headers: {
        "Reply-To": replyAddress,
        "X-SF-Warmup": "1",
        "X-SF-Warmup-System": "1",
      },
      warmupMarker: threadKey,
      configurationSet: process.env.SES_WARMUP_CONFIGURATION_SET,
      sentAt: new Date(),
    },
  });

  await prisma.warmupMessageEvent.create({
    data: {
      tenantId,
      warmupMessageId: outbound.id,
      providerMessageId: outProviderMessageId,
      eventType: "SEND",
      occurredAt: new Date(),
      snsMessageId: `warmup-reply-out:${outProviderMessageId}`,
      payload: { auto: true, side: "PROFILE" },
    },
  });

  // Increment sentCount (because this send bypasses your sender worker)
  if (emailIdentityId) {
    await prisma.warmupDailyStat.updateMany({
      where: { tenantId, emailIdentityId, date: getStartOfTodayUtcDateOnly() },
      data: { sentCount: { increment: 1 } },
    });
  }
}
