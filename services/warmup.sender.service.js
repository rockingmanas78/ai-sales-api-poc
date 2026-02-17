import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { sendEmail } from "./ses.service.js";
import {
  safeLowercaseEmail,
  getStartOfTodayUtcDateOnly,
} from "./warmup.utils.service.js";

const prisma = new PrismaClient();

function getSenderMaxPerTick() {
  const value = Number(process.env.WARMUP_SENDER_MAX_PER_TICK || 50);
  return Number.isFinite(value) && value > 0 ? value : 50;
}

function getDueDateFilter() {
  // Optional: if you add sendAfterAt in schema, enable this.
  // If not present in schema yet, keep it disabled by returning null.
  return null;
}

/**
 * SENDS ONLY WarmupMessage drafts
 *
 * IMPORTANT FIXES:
 * 1) Uses profileId (NOT emailIdentityId) for WarmupDailyStat unique key.
 * 2) Does NOT overwrite providerMessageId if SES already returned one.
 * 3) Does NOT create local SEND event or increment sentCount here
 *    (avoid double counting; let SNS handler update stats).
 * 4) Uses a single Prisma client (no connection storms).
 */
export async function runWarmupSenderTick() {
  const configurationSetName = process.env.SES_WARMUP_CONFIGURATION_SET;
  if (!configurationSetName) {
    throw new Error("SES_WARMUP_CONFIGURATION_SET is not configured");
  }

  const maxToSendThisTick = getSenderMaxPerTick();

  const dueFilter = getDueDateFilter(); // enable later if you add sendAfterAt

  const draftMessages = await prisma.warmupMessage.findMany({
    where: {
      direction: "OUTBOUND",
      sentAt: null,
      providerMessageId: null,
      ...(dueFilter ? dueFilter : {}),
    },
    include: {
      WarmupThread: {
        select: {
          tenantId: true,
          profileId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: maxToSendThisTick,
  });

  if (!draftMessages.length) {
    return { sent: 0 };
  }

  let sent = 0;

  for (const message of draftMessages) {
    let providerMessageId = null;

    try {
      const tenantId = message.tenantId;
      const profileId = message.WarmupThread?.profileId;

      if (!tenantId || !profileId) {
        console.warn("[warmupSender] skipping: missing tenantId/profileId", {
          warmupMessageId: message.id,
          tenantId,
          profileId,
        });
        continue;
      }

      const fromEmail = safeLowercaseEmail(message.from?.[0] || "");
      const toEmail = safeLowercaseEmail(message.to?.[0] || "");

      if (!fromEmail || !toEmail) {
        console.warn("[warmupSender] skipping: invalid emails", {
          warmupMessageId: message.id,
          fromEmail,
          toEmail,
        });
        continue;
      }

      const replyToHeader =
        message.headers?.["Reply-To"] ||
        message.headers?.["reply-to"] ||
        null;

      const sendResponse = await sendEmail({
        fromEmail,
        toEmail,
        subject: message.subject || "",
        htmlBody: message.html || message.text || "",
        configurationSetName,
        replyToAddresses: replyToHeader ? [String(replyToHeader)] : [],
        messageTags: [
          { Name: "tenantId", Value: String(tenantId) },
          { Name: "isWarmup", Value: "1" },
          { Name: "warmupMarker", Value: String(message.warmupMarker || "0") },
          { Name: "profileId", Value: String(profileId) }, // helpful for debugging/SNS
        ],
      });

      providerMessageId = sendResponse?.MessageId;
      if (!providerMessageId) {
        throw new Error("SES did not return MessageId");
      }

      // ✅ only persist providerMessageId + sentAt
      // (stats/events should be counted by SNS webhook)
      await prisma.warmupMessage.update({
        where: { id: message.id },
        data: {
          providerMessageId,
          sentAt: new Date(),
        },
      });

      sent += 1;
    } catch (error) {
      console.error("[warmupSender] failed", {
        warmupMessageId: message.id,
        providerMessageId,
        error: error?.message || error,
      });

      // ✅ Mark FAILED only if we never got SES MessageId
      // If SES succeeded but DB update failed, do NOT overwrite providerMessageId.
      if (!providerMessageId) {
        try {
          await prisma.warmupMessage.update({
            where: { id: message.id },
            data: {
              // Better long-term: add status + lastError fields.
              providerMessageId: `FAILED-${message.id}`,
            },
          });
        } catch (e) {
          console.error("[warmupSender] failed to mark FAILED", {
            warmupMessageId: message.id,
            error: e?.message || e,
          });
        }
      }
    }
  }

  return { sent };
}

/**
 * SENDS ONLY WarmupMessage drafts
//  */
// export async function runWarmupSenderTick() {
//   const configurationSetName = process.env.SES_WARMUP_CONFIGURATION_SET;
//   if (!configurationSetName) {
//     throw new Error("SES_WARMUP_CONFIGURATION_SET is not configured");
//   }

//   const maxToSendThisTick = getSenderMaxPerTick();
//   console.log("max tick", maxToSendThisTick);

//   const draftMessages = await prisma.warmupMessage.findMany({
//     where: {
//       direction: "OUTBOUND",
//       sentAt: null,
//       providerMessageId: null,
//     },
//     include: {
//       WarmupThread: {
//         select: {
//           tenantId: true,
//           EmailWarmupProfile: {
//             select: {
//               EmailIdentity: {
//                 select: { id: true },
//               },
//             },
//           },
//         },
//       },
//     },
//     orderBy: { createdAt: "asc" },
//     take: maxToSendThisTick,
//   });

//   if (!draftMessages.length) {
//     return { sent: 0 };
//   }

//   const todayUtcDateOnly = getStartOfTodayUtcDateOnly();
//   let sentCount = 0;

//   console.log("draft mssgs", draftMessages.length);

//   for (const message of draftMessages) {
//     try {
//       const tenantId = message.tenantId;

//       const emailIdentityId =
//         message.WarmupThread?.EmailWarmupProfile?.EmailIdentity?.id;

//       if (!tenantId || !emailIdentityId) {
//         console.warn("Skipping warmupMessage due to missing identity", message.id);
//         continue;
//       }

//       const fromEmail = safeLowercaseEmail(message.from?.[0] || "");
//       const toEmail = safeLowercaseEmail(message.to?.[0] || "");

//       if (!fromEmail || !toEmail) {
//         console.warn("Skipping warmupMessage due to invalid emails", message.id);
//         continue;
//       }

//       const replyToHeader =
//         message.headers?.["Reply-To"] ||
//         message.headers?.["reply-to"] ||
//         null;

//       const sendResponse = await sendEmail({
//         fromEmail,
//         toEmail,
//         subject: message.subject || "",
//         htmlBody: message.html || message.text || "",
//         configurationSetName,
//         replyToAddresses: replyToHeader ? [String(replyToHeader)] : [],
//         messageTags: [
//           { Name: "tenantId", Value: String(tenantId) },
//           { Name: "isWarmup", Value: "1" },
//           { Name: "warmupMarker", Value: String(message.warmupMarker || "0") },
//         ],
//       });

//       console.log("Send email response", sendResponse);

//       const providerMessageId = sendResponse?.MessageId;
//       if (!providerMessageId) {
//         throw new Error("SES did not return MessageId");
//       }

//       await prisma.$transaction(async (tx) => {
//         // 1️⃣ Update WarmupMessage
//         await tx.warmupMessage.update({
//           where: { id: message.id },
//           data: {
//             providerMessageId,
//             sentAt: new Date(),
//           },
//         });

//         // 2️⃣ Create SEND event
//         await tx.warmupMessageEvent.create({
//           data: {
//             tenantId,
//             warmupMessageId: message.id,
//             providerMessageId,
//             eventType: "SEND",
//             occurredAt: new Date(),
//             snsMessageId: `local-warmup-send-${message.id}-${crypto.randomUUID()}`,
//             payload: { warmup: true },
//           },
//         });

//         // 3️⃣ Update daily stats (single atomic upsert + increment ✅)
//         await tx.warmupDailyStat.upsert({
//           where: {
//             warmup_daily_profile_date_uq: {
//               tenantId,
//               emailIdentityId,
//               date: todayUtcDateOnly,
//             },
//           },
//           create: {
//             tenantId,
//             emailIdentityId,
//             date: todayUtcDateOnly,
//             plannedSends: 0,
//             sentCount: 1, // ✅ create with +1
//             openCount: 0,
//             replyCount: 0,
//             bounceCount: 0,
//             complaintCount: 0,
//             spamFolderCount: 0,
//           },
//           update: {
//             sentCount: { increment: 1 }, // ✅ existing +1
//           },
//         });
//       });

//       sentCount += 1;
//     } catch (error) {
//       console.error(
//         "warmup sender failed for warmupMessage:",
//         message.id,
//         error?.message || error
//       );

//       // Mark failed uniquely (avoids unique constraint issues)
//       try {
//         await prisma.warmupMessage.update({
//           where: { id: message.id },
//           data: {
//             providerMessageId: `FAILED-${message.id}`,
//           },
//         });
//       } catch (e) {
//         console.error("Failed to mark warmup message as FAILED:", message.id, e?.message || e);
//       }
//     }
//   }

//   return { sent: sentCount };
// }