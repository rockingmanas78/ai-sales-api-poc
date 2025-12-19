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
          profileId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: maxToSendThisTick,
  });

  if (!draftMessages.length) return { sent: 0 };

  const todayUtcDateOnly = getStartOfTodayUtcDateOnly();
  let sentCount = 0;

  for (const message of draftMessages) {
    try {
      const tenantId = message.tenantId;
      const profileId = message.WarmupThread.profileId;

      const fromEmail = safeLowercaseEmail(message.from?.[0] || "");
      const toEmail = safeLowercaseEmail(message.to?.[0] || "");

      if (!tenantId || !profileId || !fromEmail || !toEmail) {
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
        // Update WarmupMessage
        await tx.warmupMessage.update({
          where: { id: message.id },
          data: {
            providerMessageId,
            sentAt: new Date(),
          },
        });

        // Create SEND event
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

        // Update daily stat atomically
        await tx.warmupDailyStat.updateMany({
          where: {
            tenantId,
            profileId,
            date: todayUtcDateOnly,
          },
          data: {
            sentCount: { increment: 1 },
          },
        });
      });

      sentCount += 1;
    } catch (error) {
      console.error(
        "warmup sender failed for warmupMessage:",
        message.id,
        error?.message || error
      );

      // 🔒 Mark as failed to avoid infinite retry
      await prisma.warmupMessage.update({
        where: { id: message.id },
        data: {
          providerMessageId: "FAILED",
        },
      });
    }
  }

  return { sent: sentCount };
}
