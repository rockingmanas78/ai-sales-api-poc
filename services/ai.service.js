import axios from "axios";
import { AI_SERVICE_ENDPOINT } from "../constants/endpoints.constants.js";
import prisma from "../utils/prisma.client.js";
import { generateAuthToken } from "../utils/generateTokens.js";

/**
 * Sends the email body to the spam-score API and returns a 0–10 score.
 * @param {string} emailBody
 * @returns {Promise<number>}
 */
export async function getSpamScore(emailBody, incomingAuth) {
  const url = `${AI_SERVICE_ENDPOINT}/api/get_spam_score`;
  const payload = { email_body: emailBody };
  const resp = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: incomingAuth,
    },
    timeout: 5_000,
  });
  console.log("Status", resp.status);

  // assuming the API returns { score: number } – adjust if it's just the number
  if (resp.status !== 200) {
    throw new Error(`Spam API responded ${resp.status}`);
  }
  // adapt this to resp.data if the shape differs
  return typeof resp.data === "number" ? resp.data : resp.data.score;
}

/**
 * Map AI sentiment (free text) to your LeadStatus enum.
 */
function mapSentimentToLeadStatus(sentimentRaw) {
  const s = String(sentimentRaw || "")
    .trim()
    .toUpperCase();

  if (s.includes("NOT INTERESTED")) return "NOT_INTERESTED";
  if (s.includes("IMMEDIATE")) return "IMMEDIATE_ACTION";
  if (s.includes("FOLLOW")) return "FOLLOW_UP";
  if (s.includes("INTERESTED")) return "INTERESTED";

  // Default: be conservative (don't close a door)
  return "FOLLOW_UP";
}

/**
 * Very small HTML stripper in case we only have html.
 */
function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Main entrypoint: run sentiment analysis and schedule AI reply
 * Idempotent per inbound message: uses EmailMessage.verdicts flags to skip repeats.
 */
export async function runPostInboundAutomation({
  tenantId,
  conversationId,
  inboundMessageId,
}) {
  // 1) Load the inbound email (and some context we need)
  const inbound = await prisma.emailMessage.findFirst({
    where: { id: inboundMessageId, tenantId, direction: "INBOUND" },
    select: {
      id: true,
      subject: true,
      text: true,
      html: true,
      from: true,
      to: true,
      verdicts: true,
      leadId: true,
      campaignId: true,
      conversationId: true,
    },
  });

  if (!inbound) {
    console.warn("runPostInboundAutomation: inbound message not found", {
      inboundMessageId,
      tenantId,
    });
    return;
  }

  // Idempotency guard: if we already processed AI reply for this inbound, skip
  // if (inbound.verdicts && (inbound.verdicts.aiReplyScheduled || inbound.verdicts.aiProcessed)) {
  //   console.log("runPostInboundAutomation: already processed; skipping", { inboundMessageId });
  //   return;
  // }

  // 2) Determine sender (our side) & recipients (lead side)
  // We reply from the most recent OUTBOUND in this conversation; fall back gracefully.
  const lastOutbound = await prisma.emailMessage.findFirst({
    where: { tenantId, conversationId, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
    select: { from: true },
  });

  const senderEmail = lastOutbound?.from?.[0]; // required by /email/generate
  const recipientEmails = inbound.from?.length ? inbound.from : []; // the lead wrote to us; reply to them

  if (!senderEmail || recipientEmails.length === 0) {
    console.warn(
      "runPostInboundAutomation: missing sender or recipient; skipping /generate",
      {
        senderEmail,
        recipientEmails,
        conversationId,
      }
    );
  }

  const latestEmailPlain =
    inbound.text && inbound.text.trim().length > 0
      ? inbound.text
      : stripHtml(inbound.html);

  // 3) Call /email/analyse (sentiment)
  let sentiment = "FOLLOW UP";
  try {
    const { data } = await axios.post(
      `${AI_SERVICE_ENDPOINT}/api/email/analyse`,
      { subject: inbound.subject || "", body: latestEmailPlain || "" },
      {
        headers: {
          "Content-Type": "application/json",
          // "Authorization": passthroughAuthToken,
          "x-internal-secret": process.env.WEBHOOK_SECRET,
        },
        timeout: 10_000,
      }
    );
    sentiment = data?.sentiment || sentiment;
    console.log("AI /email/analyse result:", { sentiment });
  } catch (err) {
    console.error(
      "AI /email/analyse failed; proceeding with default",
      err?.response?.data || err.message
    );
  }

  const newLeadStatus = mapSentimentToLeadStatus(sentiment);

  console.log("New lead status from sentiment:", { sentiment, newLeadStatus });

  // 4) Update the lead's status if we have a leadId
  if (inbound.leadId) {
    try {
      await prisma.lead.update({
        where: { id: inbound.leadId },
        data: { status: newLeadStatus },
      });
      console.log("Lead status updated:", {
        leadId: inbound.leadId,
        newLeadStatus,
      });
    } catch (err) {
      console.error(
        "Failed to update lead status",
        err?.response?.data || err.message
      );
    }
  }

  // 5) Call /email/generate to create & schedule the reply (only if we have sender+recipients)
  if (senderEmail && recipientEmails.length > 0) {
    try {
      const response = await axios.post(
        `${AI_SERVICE_ENDPOINT}/api/email/generate`,
        {
          conversation_id: conversationId,
          campaign_id: inbound.campaignId || "",
          latest_email: latestEmailPlain || "",
          sender_name: senderEmail.split("@")[0], // optional: look up a real name via Users table if you want
          sender_email: senderEmail,
          recipient_emails: recipientEmails,
          lead_id: inbound.leadId || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
            // Authorization: passthroughAuthToken || "", // forward user's JWT if available
            "x-internal-secret": process.env.WEBHOOK_SECRET,
            "tenant-id": tenantId,
          },
          timeout: 20_000,
        }
      );

      console.log("AI /email/generate result:", response.data);
    } catch (err) {
      console.error(
        "AI /email/generate failed",
        err?.response?.data || err.message
      );
      // do not throw; we already updated lead status & sentiment
    }
  }
}
