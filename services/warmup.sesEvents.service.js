import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/* ---------------- helpers ---------------- */

function tryParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeEventEnvelope(body) {
  if (!body) return null;

  if (body.Type && body.Message) {
    const sesEvent =
      typeof body.Message === "string" ? tryParseJson(body.Message) : body.Message;
    return { snsMessageId: body.MessageId, sesEvent };
  }

  if (body.mail && body.eventType) {
    return {
      snsMessageId: body.snsMessageId || `direct-${Date.now()}`,
      sesEvent: body,
    };
  }

  return null;
}

function extractOccurredAt(sesEvent) {
  const eventTypeLower = String(sesEvent?.eventType || "").toLowerCase();

  const timestampValue =
    (eventTypeLower === "send" && sesEvent?.send?.timestamp) ||
    (eventTypeLower === "delivery" && sesEvent?.delivery?.timestamp) ||
    (eventTypeLower === "bounce" && sesEvent?.bounce?.timestamp) ||
    (eventTypeLower === "complaint" && sesEvent?.complaint?.timestamp) ||
    (eventTypeLower === "open" && sesEvent?.open?.timestamp) ||
    (eventTypeLower === "click" && sesEvent?.click?.timestamp) ||
    sesEvent?.mail?.timestamp ||
    Date.now();

  return new Date(timestampValue);
}

function getRecipientDomain(email) {
  const parts = String(email || "").split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

function todayUtcDateOnly() {
  const nowDate = new Date();
  return new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));
}

/**
 * Increment WarmupInboxDailyCounter.sent for a warmup inbox.
 */
async function incrementWarmupInboxSentCounter({
  warmupInboxId,
  dateUtc,
  tenantId,
}) {
  if (!warmupInboxId) return;

  await prisma.warmupInboxDailyCounter.upsert({
    where: {
      warmup_inbox_date_uq: {
        warmup_inbox_id: warmupInboxId,
        date: dateUtc,
      },
    },
    create: {
      warmup_inbox_id: warmupInboxId,
      date: dateUtc,
      planned: 0,
      sent: 1,
      tenant_id: tenantId || null,
    },
    update: {
      sent: { increment: 1 },
      ...(tenantId ? { tenant_id: tenantId } : {}),
    },
  });
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export async function processWarmupSesSnsEvent(requestBody) {
  const envelope = normalizeEventEnvelope(requestBody);
  if (!envelope?.sesEvent) return;

  const sesEvent = envelope.sesEvent;
  const providerMessageId = sesEvent?.mail?.messageId;
  if (!providerMessageId) return;

  const eventType = String(sesEvent?.eventType || "").toUpperCase();
  const tags = sesEvent?.mail?.tags || {};

  const tenantId = Array.isArray(tags?.tenantId) ? tags.tenantId[0] : tags?.tenantId;
  const isWarmup = Array.isArray(tags?.isWarmup) ? tags.isWarmup[0] : tags?.isWarmup;

  // hard isolation: only warmup-tagged events allowed here
  if (!tenantId || String(isWarmup) !== "1") return;

  const occurredAt = extractOccurredAt(sesEvent);

  // stable unique sns message id
  const snsMessageId =
    String(envelope.snsMessageId || "") ||
    `warmup:${providerMessageId}:${eventType}:${occurredAt.toISOString()}`;

  /* Locate WarmupMessage + related thread for identity + inbox */
  const warmupMessage = await prisma.warmupMessage.findFirst({
    where: { tenantId, providerMessageId },
    include: {
      WarmupThread: {
        select: {
          id: true,
          inboxId: true,
          EmailWarmupProfile: { select: { emailIdentityId: true } },
        },
      },
    },
  });

  const emailIdentityId = warmupMessage?.WarmupThread?.EmailWarmupProfile?.emailIdentityId;
  const warmupInboxId = warmupMessage?.WarmupThread?.inboxId;

  if (!emailIdentityId) return;

  const recipient = sesEvent?.mail?.destination?.[0] || warmupMessage.to?.[0] || null;
  const recipientDomain = getRecipientDomain(recipient);

  let bounceType = null;
  let complaintType = null;

  if (eventType === "BOUNCE") bounceType = sesEvent?.bounce?.bounceType || null;
  if (eventType === "COMPLAINT") {
    complaintType = sesEvent?.complaint?.complaintFeedbackType || null;
  }

  /* Create WarmupMessageEvent idempotently */
  await prisma.warmupMessageEvent.upsert({
    where: { snsMessageId },
    create: {
      tenantId,
      warmupMessageId: warmupMessage.id,
      providerMessageId,
      eventType,
      occurredAt,
      snsMessageId,
      payload: sesEvent,
      recipient,
      recipientDomain,
      bounceType,
      complaintType,
    },
    update: {},
  });

  /* Update WarmupDailyStat */
  const dateUtc = todayUtcDateOnly();

  const incrementMap = {
    SEND: { sentCount: { increment: 1 } },
    DELIVERY: {},
    OPEN: { openCount: { increment: 1 } },
    BOUNCE: { bounceCount: { increment: 1 } },
    COMPLAINT: { complaintCount: { increment: 1 } },
  };

  const statUpdate = incrementMap[eventType];
  if (statUpdate && Object.keys(statUpdate).length) {
    await prisma.warmupDailyStat.upsert({
      where: {
        warmup_daily_profile_date_uq: { tenantId, emailIdentityId, date: dateUtc },
      },
      create: {
        tenantId,
        emailIdentityId,
        date: dateUtc,
        plannedSends: 0,
        sentCount: 0,
        openCount: 0,
        replyCount: 0,
        bounceCount: 0,
        complaintCount: 0,
        spamFolderCount: 0,
        ...Object.fromEntries(
          Object.entries(statUpdate).map(([key, value]) => [
            key,
            value.increment ? value.increment : value,
          ])
        ),
      },
      update: statUpdate,
    });
  }

  // ✅ NEW: increment inbox sent counter on SEND
  if (eventType === "SEND" && warmupInboxId) {
    await incrementWarmupInboxSentCounter({
      warmupInboxId,
      dateUtc,
      tenantId,
    });
  }
}



// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();

// /* ---------------- helpers ---------------- */

// function tryParseJson(input) {
//   try {
//     return JSON.parse(input);
//   } catch {
//     return null;
//   }
// }

// function normalizeEventEnvelope(body) {
//   if (!body) return null;

//   if (body.Type && body.Message) {
//     const sesEvent = typeof body.Message === "string" ? tryParseJson(body.Message) : body.Message;
//     return { snsMessageId: body.MessageId, sesEvent };
//   }

//   if (body.mail && body.eventType) {
//     return {
//       snsMessageId: body.snsMessageId || `direct-${Date.now()}`,
//       sesEvent: body,
//     };
//   }

//   return null;
// }

// function extractOccurredAt(sesEvent) {
//   const eventType = String(sesEvent?.eventType || "").toLowerCase();

//   const ts =
//     (eventType === "send" && sesEvent?.send?.timestamp) ||
//     (eventType === "delivery" && sesEvent?.delivery?.timestamp) ||
//     (eventType === "bounce" && sesEvent?.bounce?.timestamp) ||
//     (eventType === "complaint" && sesEvent?.complaint?.timestamp) ||
//     (eventType === "open" && sesEvent?.open?.timestamp) ||
//     (eventType === "click" && sesEvent?.click?.timestamp) ||
//     sesEvent?.mail?.timestamp ||
//     Date.now();

//   return new Date(ts);
// }


// function getRecipientDomain(email) {
//   const parts = String(email || "").split("@");
//   return parts.length === 2 ? parts[1].toLowerCase() : null;
// }

// /* =========================================================
//    MAIN HANDLER
// ========================================================= */

// function todayUtcDateOnly() {
//   const now = new Date();
//   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
// }

// /* =========================================================
//    MAIN HANDLER
// ========================================================= */

// export async function processWarmupSesSnsEvent(requestBody) {
//   const envelope = normalizeEventEnvelope(requestBody);
//   if (!envelope?.sesEvent) return;

//   const sesEvent = envelope.sesEvent;
//   const providerMessageId = sesEvent?.mail?.messageId;
//   if (!providerMessageId) return;

//   const eventType = String(sesEvent?.eventType || "").toUpperCase();
//   const tags = sesEvent?.mail?.tags || {};

//   const tenantId = Array.isArray(tags?.tenantId) ? tags.tenantId[0] : tags?.tenantId;
//   const isWarmup = Array.isArray(tags?.isWarmup) ? tags.isWarmup[0] : tags?.isWarmup;

//   // hard isolation: only warmup-tagged events allowed here
//   if (!tenantId || String(isWarmup) !== "1") return;

//   // IMPORTANT: snsMessageId MUST be stable/unique; SNS provides MessageId.
//   // If you're passing direct events, it's okay but idempotency is weaker.
//   const snsMessageId =
//     String(envelope.snsMessageId || "") || `warmup:${providerMessageId}:${eventType}:${extractOccurredAt(sesEvent).toISOString()}`;

//   /* Locate WarmupMessage */
//   const warmupMessage = await prisma.warmupMessage.findFirst({
//     where: { tenantId, providerMessageId },
//     include: {
//       WarmupThread: {
//         select: {
//           id: true,
//           EmailWarmupProfile: { select: { emailIdentityId: true } },
//         },
//       },
//     },
//   });

//   if (!warmupMessage?.WarmupThread?.EmailWarmupProfile?.emailIdentityId) return;

//   const emailIdentityId = warmupMessage.WarmupThread.EmailWarmupProfile.emailIdentityId;

//   const recipient = sesEvent?.mail?.destination?.[0] || warmupMessage.to?.[0] || null;
//   const recipientDomain = getRecipientDomain(recipient);

//   let bounceType = null;
//   let complaintType = null;

//   if (eventType === "BOUNCE") bounceType = sesEvent?.bounce?.bounceType || null;
//   if (eventType === "COMPLAINT") {
//     complaintType = sesEvent?.complaint?.complaintFeedbackType || null;
//   }

//   const occurredAt = extractOccurredAt(sesEvent);

//   /* Create WarmupMessageEvent idempotently (prevents dupes under concurrency) */
//   await prisma.warmupMessageEvent.upsert({
//     where: { snsMessageId },
//     create: {
//       tenantId,
//       warmupMessageId: warmupMessage.id,
//       providerMessageId,
//       eventType,
//       occurredAt,
//       snsMessageId,
//       payload: sesEvent,
//       recipient,
//       recipientDomain,
//       bounceType,
//       complaintType,
//     },
//     update: {}, // idempotent
//   });

//   /* Update WarmupDailyStat (upsert so row always exists) */
//   const date = todayUtcDateOnly();

//   const incrementMap = {
//     SEND: { sentCount: { increment: 1 } },
//     DELIVERY: {}, // optional if you want to track
//     OPEN: { openCount: { increment: 1 } },
//     BOUNCE: { bounceCount: { increment: 1 } },
//     COMPLAINT: { complaintCount: { increment: 1 } },
//   };

//   const statUpdate = incrementMap[eventType];
//   if (!statUpdate || Object.keys(statUpdate).length === 0) return;

//   await prisma.warmupDailyStat.upsert({
//     where: {
//       warmup_daily_profile_date_uq: { tenantId, emailIdentityId, date },
//     },
//     create: {
//       tenantId,
//       emailIdentityId,
//       date,
//       plannedSends: 0,
//       sentCount: 0,
//       openCount: 0,
//       replyCount: 0,
//       bounceCount: 0,
//       complaintCount: 0,
//       spamFolderCount: 0,
//       ...Object.fromEntries(
//         Object.entries(statUpdate).map(([k, v]) => [k, (v.increment ? v.increment : v)])
//       ),
//     },
//     update: statUpdate,
//   });
// }
