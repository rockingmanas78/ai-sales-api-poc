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

/**
 * SENDS ONLY WarmupMessage drafts
 */
export async function runWarmupSenderTick() {
  const configurationSetName = process.env.SES_WARMUP_CONFIGURATION_SET;
  if (!configurationSetName) {
    throw new Error("SES_WARMUP_CONFIGURATION_SET is not configured");
  }

  const maxToSendThisTick = getSenderMaxPerTick();

  const draftMessages = await prisma.warmupMessage.findMany({
    where: {
      direction: "OUTBOUND",
      sentAt: null,
      providerMessageId: null,
    },
    include: {
      WarmupThread: {
        select: {
          tenantId: true,
          EmailWarmupProfile: {
            select: {
              EmailIdentity: {
                select: { id: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: maxToSendThisTick,
  });

  if (!draftMessages.length) {
    return { sent: 0 };
  }

  const todayUtcDateOnly = getStartOfTodayUtcDateOnly();
  let sentCount = 0;

  for (const message of draftMessages) {
    try {
      const tenantId = message.tenantId;

      const emailIdentityId =
        message.WarmupThread?.EmailWarmupProfile?.EmailIdentity?.id;

      if (!tenantId || !emailIdentityId) {
        console.warn(
          "Skipping warmupMessage due to missing identity",
          message.id
        );
        continue;
      }

      const fromEmail = safeLowercaseEmail(message.from?.[0] || "");
      const toEmail = safeLowercaseEmail(message.to?.[0] || "");

      if (!fromEmail || !toEmail) {
        console.warn(
          "Skipping warmupMessage due to invalid emails",
          message.id
        );
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
          { Name: "tenantId", Value: tenantId },
          { Name: "isWarmup", Value: "1" },
          { Name: "warmupMarker", Value: message.warmupMarker },
        ],
      });

      const providerMessageId = sendResponse?.MessageId;
      if (!providerMessageId) {
        throw new Error("SES did not return MessageId");
      }

      await prisma.$transaction(async (tx) => {
        // 1️⃣ Update WarmupMessage
        await tx.warmupMessage.update({
          where: { id: message.id },
          data: {
            providerMessageId,
            sentAt: new Date(),
          },
        });

        // 2️⃣ Create SEND event
        await tx.warmupMessageEvent.create({
          data: {
            tenantId,
            warmupMessageId: message.id,
            providerMessageId,
            eventType: "SEND",
            occurredAt: new Date(),
            snsMessageId: `local-warmup-send-${message.id}-${crypto.randomUUID()}`,
            payload: { warmup: true },
          },
        });

        // 3️⃣ Update daily stats (IDENTITY-BASED ✅)
        // inside runWarmupSenderTick loop, before updateMany:

        await prisma.warmupDailyStat.upsert({
          where: {
            warmup_daily_profile_date_uq: {
              tenantId,
              emailIdentityId,
              date: todayUtcDateOnly,
            },
          },
          create: {
            tenantId,
            emailIdentityId,
            date: todayUtcDateOnly,
            plannedSends: 0,
            sentCount: 0,
            openCount: 0,
            replyCount: 0,
            bounceCount: 0,
            complaintCount: 0,
            spamFolderCount: 0,
          },
          update: {},
        });

        // then do your updateMany / update:
        await prisma.warmupDailyStat.updateMany({
          where: { tenantId, emailIdentityId, date: todayUtcDateOnly },
          data: { sentCount: { increment: 1 } },
        });

      });

      sentCount += 1;
    } catch (error) {
      console.error(
        "warmup sender failed for warmupMessage:",
        message.id,
        error?.message || error
      );

      // 🔒 Mark failed uniquely (avoids UNIQUE constraint crash)
      await prisma.warmupMessage.update({
        where: { id: message.id },
        data: {
          providerMessageId: `FAILED-${message.id}`,
        },
      });
    }
  }

  return { sent: sentCount };
}
