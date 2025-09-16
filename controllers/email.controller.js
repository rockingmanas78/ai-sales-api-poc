import crypto from "crypto";
import { getSpamScore } from "../services/ai.service.js";
import * as emailService from "../services/email.service.js";
// controllers/send-via-lead.controller.js
import { PrismaClient } from "@prisma/client";
import {
  sendEmail,
  sendRawEmailWithHeaders,
  sendEmail as sesSendEmail,
} from "../services/ses.service.js";

const prisma = new PrismaClient();

export async function createEmail(req, res, next) {
  try {
    const { to, from, subject, body } = req.body;
    const email = await emailService.queueEmail({ to, from, subject, body });
    res.status(201).json(email);
  } catch (err) {
    next(err);
  }
}

export async function getEmails(req, res, next) {
  try {
    const emails = await emailService.listEmails();
    res.json(emails);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/spam-score
 * { emailBody: string }
 */
export async function spamScoreController(req, res, next) {
  try {
    const { emailBody } = req.body;
    if (!emailBody || typeof emailBody !== "string") {
      return res
        .status(400)
        .json({ error: "emailBody is required as a string" });
    }
    const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const score = await getSpamScore(emailBody, incomingAuth);
    res.json({ score });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/send-via-lead
 *
 * New flow (EmailMessage + Conversation + SES send):
 * 1) Resolve lead
 * 2) Ensure campaign/template (same as before)
 * 3) Create a queued OUTBOUND EmailMessage (mint plusToken)
 * 4) Resolve inbound domain + compute reply-to (reuse conversation.threadKey when provided)
 * 5) Send (RAW for follow-ups to attach RFC headers, otherwise simple SendEmail)
 * 6) Transaction: upsert Conversation, update EmailMessage with providerMessageId/sentAt/headers
 *
 * Note: lifecycle events (delivery/open/click/bounce/complaint) are written by your SNS handler as EmailEvent.
 */
export async function sendMailViaLead(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const {
      leadId,
      subject,
      htmlBody,
      fromEmail,
      conversationId,
      configurationSetName, // optional
      campaignId: campaignIdInput, // optional
    } = req.body;

    if (!tenantId || !leadId || !subject || !htmlBody || !fromEmail) {
      return res.status(400).json({
        error: "tenantId, leadId, subject, htmlBody, fromEmail are required",
      });
    }

    // 1) Resolve lead
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, contactEmail: true },
    });
    if (!lead) return res.status(404).json({ error: "lead not found" });
    const toEmail = lead.contactEmail?.[0];
    if (!toEmail) return res.status(400).json({ error: "lead has no contactEmail" });

    // 2) Ensure campaign/template (same as your flow)
    let campaignId = campaignIdInput || null;
    if (!campaignId) {
      const [template, campaign] = await prisma.$transaction(async (tx) => {
        let template = await tx.emailTemplate.findFirst({
          where: { tenantId, name: "Direct Send (System)" },
          select: { id: true },
        });
        if (!template) {
          template = await tx.emailTemplate.create({
            data: {
              tenantId,
              name: "Direct Send (System)",
              subject: "Direct Send",
              body: "<p>{{body}}</p>",
              from: fromEmail,
              to: "{{lead.email}}",
            },
            select: { id: true },
          });
        }
        let campaign = await tx.emailCampaign.findFirst({
          where: { tenantId, name: "Direct Send", templateId: template.id },
          select: { id: true },
        });
        if (!campaign) {
          campaign = await tx.emailCampaign.create({
            data: {
              tenantId,
              templateId: template.id,
              status: "ACTIVE",
              name: "Direct Send",
              description: "Ad-hoc single sends",
              campaign_type: "LEAD_NURTURING",
            },
            select: { id: true },
          });
        }
        return [template, campaign];
      });
      campaignId = campaign.id;
    }

    // 3) Reuse threadKey from conversation if provided, else mint a new plusToken
    let existingConversation = null;
    if (conversationId) {
      existingConversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true, threadKey: true, participants: true },
      });
      if (!existingConversation) {
        return res.status(404).json({ error: "conversation not found for this tenant" });
      }
    }

    // 4) Resolve verified inbound subdomain
    const inbound = await prisma.domainIdentity.findFirst({
      where: {
        tenantId,
        domainName: { startsWith: "inbound." },
        verificationStatus: "Success",
      },
      select: { domainName: true },
    });
    if (!inbound) {
      return res.status(400).json({ error: "Inbound subdomain not verified for this tenant" });
    }

    const plusToken = existingConversation ? existingConversation.threadKey : crypto.randomUUID();
    const replyTo = `reply+${plusToken}@${inbound.domainName}`;

    // 5) Determine parent for reply headers (if replying)
    // Prefer the last message's RFC Message-ID (from stored headers) if available.
    let usedInReplyTo = null;
    let usedReferences = null;
    let dbInReplyTo = null; // for EmailMessage.inReplyTo to link parent in UI

    if (existingConversation) {
      const parent = await prisma.emailMessage.findFirst({
        where: { tenantId, conversationId: existingConversation.id },
        orderBy: { createdAt: "desc" },
        select: { providerMessageId: true, headers: true },
      });

      const parentHeaderMsgId =
        (parent?.headers && (parent.headers["Message-ID"] || parent.headers["message-id"])) || null;

      // Only set RFC threading headers when we have a real Message-ID string
      if (parentHeaderMsgId) {
        usedInReplyTo = parentHeaderMsgId;
        usedReferences = parentHeaderMsgId;
      }
      // For UI, still record which providerMessageId we intended to reply to
      if (parent?.providerMessageId) dbInReplyTo = parent.providerMessageId;
    }

    // 6) Send first (Raw if we need RFC headers, else classic)
    const messageTags = [
      { Name: "tenantId", Value: tenantId },
      { Name: "replyToToken", Value: plusToken },
      ...(campaignId ? [{ Name: "campaignId", Value: campaignId }] : []),
      { Name: "leadId", Value: leadId },
    ];

    let sendResult;
    if (usedInReplyTo || usedReferences) {
      // Need custom headers → Raw
      sendResult = await sendRawEmailWithHeaders({
        fromEmail,
        toEmail,
        subject,
        htmlBody: htmlBody,
        replyTo,
        extraHeaders: {
          ...(usedInReplyTo ? { "In-Reply-To": usedInReplyTo } : {}),
          ...(usedReferences ? { References: usedReferences } : {}),
        },
        configurationSetName: configurationSetName || process.env.SES_CONFIGURATION_SET,
        messageTags,
      }); // returns { MessageId }
    } else {
      // No custom headers → classic send w/ Reply-To
      sendResult = await sendEmail({
        fromEmail,
        toEmail,
        subject,
        htmlBody,
        configurationSetName: configurationSetName || process.env.SES_CONFIGURATION_SET,
        replyToAddresses: [replyTo],
        messageTags,
      }); // returns { MessageId }
    }

    const providerMessageId = sendResult?.MessageId;
    if (!providerMessageId) {
      return res.status(502).json({ error: "SES did not return MessageId" });
    }

    // 7) Persist in a single transaction
    const { id: conversationIdFinal, emailMessageId } = await prisma.$transaction(async (tx) => {
      // Upsert conversation by (tenantId, threadKey=plusToken)
      const conversation = existingConversation
        ? await tx.conversation.update({
            where: { id: existingConversation.id },
            data: {
              // set subject only if empty to keep thread title stable
              ...(existingConversation.subject ? {} : { subject }),
              participants: {
                set: Array.from(
                  new Set([fromEmail, toEmail, ...(existingConversation.participants || [])])
                ),
              },
              lastMessageAt: new Date(),
            },
            select: { id: true },
          })
        : await tx.conversation.upsert({
            where: { tenantId_threadKey: { tenantId, threadKey: plusToken } },
            create: {
              tenantId,
              threadKey: plusToken,
              subject,
              participants: [fromEmail, toEmail],
              firstMessageAt: new Date(),
              lastMessageAt: new Date(),
            },
            update: {
              // only set subject if currently null
              ...( (await tx.conversation.findUnique({
                    where: { tenantId_threadKey: { tenantId, threadKey: plusToken } },
                    select: { subject: true },
                  }))?.subject
                  ? {}
                  : { subject }
              ),
              participants: {
                set: Array.from(
                  new Set([
                    fromEmail,
                    toEmail,
                    ...(
                      (await tx.conversation.findUnique({
                        where: { tenantId_threadKey: { tenantId, threadKey: plusToken } },
                        select: { participants: true },
                      }))?.participants || []
                    ),
                  ])
                ),
              },
              lastMessageAt: new Date(),
            },
            select: { id: true },
          });

      // Create OUTBOUND EmailMessage (after send)
      const msg = await tx.emailMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          provider: "AWS_SES",
          providerMessageId,
          subject,
          from: [fromEmail],
          to: [toEmail],
          html: htmlBody,
          headers: {
            "Reply-To": replyTo,
            ...(usedInReplyTo ? { "In-Reply-To": usedInReplyTo } : {}),
            ...(usedReferences ? { References: usedReferences } : {}),
          },
          verdicts: {},
          inReplyTo: dbInReplyTo,        // <-- link to parent in DB for UI
          plusToken: plusToken,          // threadKey === plusToken
          sentAt: new Date(),
          campaignId: campaignId || null,
          leadId,
          lastDeliveryStatus: "SENT",
        },
        select: { id: true },
      });

      return { id: conversation.id, emailMessageId: msg.id };
    });

    res.json({
      message: "Email sent",
      leadId,
      conversationId: conversationIdFinal,
      emailMessageId,
      messageId: providerMessageId,
      replyTo,
    });
  } catch (err) {
    next(err);
  }
}


// export async function sendMailViaLead(req, res, next) {
//   try {
//     const tenantId = req.user?.tenantId;
//     const {
//       leadId,
//       subject,
//       htmlBody,
//       fromEmail,
//       conversationId,
//       configurationSetName, // optional if you keep a default
//       campaignId: campaignIdInput, // optional
//     } = req.body;

//     if (!tenantId || !leadId || !subject || !htmlBody || !fromEmail) {
//       return res.status(400).json({
//         error: "tenantId, leadId, subject, htmlBody, fromEmail are required",
//       });
//     }

//     // 1) Load lead and resolve recipient
//     const lead = await prisma.lead.findFirst({
//       where: { id: leadId, tenantId },
//       select: { id: true, contactEmail: true },
//     });
//     if (!lead) return res.status(404).json({ error: "lead not found" });
//     const toEmail = lead.contactEmail?.[0];
//     if (!toEmail)
//       return res.status(400).json({ error: "lead has no contactEmail" });

//     // 2) Ensure we have a campaign/template if not provided
//     let campaignId = campaignIdInput || null;
//     if (!campaignId) {
//       const [template, campaign] = await prisma.$transaction(async (tx) => {
//         let template = await tx.emailTemplate.findFirst({
//           where: { tenantId, name: "Direct Send (System)" },
//           select: { id: true },
//         });
//         if (!template) {
//           template = await tx.emailTemplate.create({
//             data: {
//               tenantId,
//               name: "Direct Send (System)",
//               subject: "Direct Send",
//               body: "<p>{{body}}</p>",
//               from: fromEmail,
//               to: "{{lead.email}}",
//             },
//             select: { id: true },
//           });
//         }
//         let campaign = await tx.emailCampaign.findFirst({
//           where: { tenantId, name: "Direct Send", templateId: template.id },
//           select: { id: true },
//         });
//         if (!campaign) {
//           campaign = await tx.emailCampaign.create({
//             data: {
//               tenantId,
//               templateId: template.id,
//               status: "ACTIVE",
//               name: "Direct Send",
//               description: "Ad-hoc single sends",
//               campaign_type: "LEAD_NURTURING",
//             },
//             select: { id: true },
//           });
//         }
//         return [template, campaign];
//       });
//       campaignId = campaign.id;
//     }

//     // 3) If conversationId supplied, load its threadKey so we reuse it; else we'll create a new plusToken
//     let existingConversation = null;
//     if (conversationId) {
//       existingConversation = await prisma.conversation.findFirst({
//         where: { id: conversationId, tenantId },
//         select: { id: true, threadKey: true, participants: true },
//       });
//       if (!existingConversation) {
//         return res
//           .status(404)
//           .json({ error: "conversation not found for this tenant" });
//       }
//     }

//     // 4) Resolve inbound subdomain for this tenant (must be verified in SES)
//     const inbound = await prisma.domainIdentity.findFirst({
//       where: {
//         tenantId,
//         domainName: { startsWith: "inbound." },
//         // keep your existing verification check string (adjust if your app uses different status)
//         verificationStatus: "Success",
//       },
//       select: { domainName: true },
//     });
//     if (!inbound)
//       return res
//         .status(400)
//         .json({ error: "Inbound subdomain not verified for this tenant" });

//     // 5) Create queued OUTBOUND EmailMessage to mint stable id / plusToken (plusToken is stable and used for reply+{token})
//     // If we have an existing conversation, reuse its threadKey as the plusToken; otherwise generate one.
//     const initialPlusToken = existingConversation
//       ? existingConversation.threadKey
//       : crypto.randomUUID();

//     const queuedMessage = await prisma.emailMessage.create({
//       data: {
//         tenantId,
//         // conversationId will be set/updated in the transaction after upsert/upd
//         direction: "OUTBOUND",
//         provider: "AWS_SES",
//         subject,
//         from: [fromEmail],
//         to: [toEmail],
//         html: htmlBody,
//         headers: {}, // filled after send (Reply-To, In-Reply-To etc.)
//         verdicts: {},
//         plusToken: initialPlusToken,
//         campaignId,
//         leadId,
//         // set a pre-send status in the aggregate column (helps UI)
//         lastDeliveryStatus: "QUEUED",
//         createdAt: new Date(),
//       },
//     });

//     // reply-to uses the threadKey / plusToken
//     const replyToToken = initialPlusToken;
//     const replyTo = `reply+${replyToToken}@${inbound.domainName}`;

//     // 6) Decide how to send:
//     //    - If existingConversation provided: enrich headers with In-Reply-To/References and RAW send.
//     //    - Otherwise: simple SES send with Reply-To.
//     let result;
//     let usedInReplyTo = null;
//     let usedReferences = null;

//     if (existingConversation) {
//       // find last message in the conversation (prefer OUTBOUND, else any)
//       const last = await prisma.emailMessage.findFirst({
//         where: { tenantId, conversationId: existingConversation.id },
//         orderBy: { createdAt: "desc" },
//         select: { providerMessageId: true, headers: true },
//       });

//       const lastHeaderMsgId =
//         (last?.headers &&
//           (last.headers["Message-ID"] || last.headers["message-id"])) ||
//         null;
//       const regionHost = `${
//         process.env.AWS_SES_REGION || "ap-south-1"
//       }.amazonses.com`;
//       const priorRef = lastHeaderMsgId
//         ? lastHeaderMsgId
//         : last?.providerMessageId
//         ? `<${last.providerMessageId}@${regionHost}>`
//         : null;

//       const extraHeaders = {};
//       if (priorRef) {
//         usedInReplyTo = priorRef;
//         usedReferences = priorRef;
//         extraHeaders["In-Reply-To"] = priorRef;
//         extraHeaders["References"] = priorRef;
//       }

//       // RAW send to add custom headers (Reply-To + threading headers)
//       result = await sendRawEmailWithHeaders({
//         fromEmail,
//         toEmail,
//         subject,
//         htmlBody,
//         replyTo,
//         extraHeaders,
//         configurationSetName:
//           configurationSetName || process.env.SES_CONFIGURATION_SET,
//         messageTags: [
//           { Name: "tenantId", Value: tenantId },
//           { Name: "emailMessageId", Value: queuedMessage.id },
//         ],
//       });
//     } else {
//       // First message in a new thread — simple send is fine
//       result = await sesSendEmail({
//         fromEmail,
//         toEmail,
//         subject,
//         htmlBody,
//         configurationSetName:
//           configurationSetName || process.env.SES_CONFIGURATION_SET,
//         replyToAddresses: [replyTo],
//         messageTags: [
//           { Name: "tenantId", Value: tenantId },
//           { Name: "emailMessageId", Value: queuedMessage.id },
//         ],
//       });
//     }

//     // 7) DB transaction: upsert Conversation, update EmailMessage with providerMessageId / sentAt / headers / lastDeliveryStatus
//     await prisma.$transaction(
//       async (tx) => {
//         const threadKey = replyToToken;

//         const conversation = existingConversation
//           ? await tx.conversation.update({
//               where: { id: existingConversation.id },
//               data: {
//                 subject: { set: subject },
//                 participants: {
//                   set: Array.from(
//                     new Set([
//                       fromEmail,
//                       toEmail,
//                       ...(existingConversation.participants || []),
//                     ])
//                   ),
//                 },
//                 lastMessageAt: new Date(),
//               },
//             })
//           : await tx.conversation.upsert({
//               where: { tenantId_threadKey: { tenantId, threadKey } },
//               create: {
//                 tenantId,
//                 threadKey,
//                 subject,
//                 participants: [fromEmail, toEmail],
//               },
//               update: {
//                 subject: { set: subject },
//                 participants: {
//                   set: Array.from(
//                     new Set([
//                       fromEmail,
//                       toEmail,
//                       // ensure we don't lose existing participants
//                       ...((
//                         await tx.conversation.findUnique({
//                           where: {
//                             tenantId_threadKey: { tenantId, threadKey },
//                           },
//                           select: { participants: true },
//                         })
//                       )?.participants || []),
//                     ])
//                   ),
//                 },
//                 lastMessageAt: new Date(),
//               },
//             });

//         // update the queued message with final metadata
//         await tx.emailMessage.update({
//           where: { id: queuedMessage.id },
//           data: {
//             conversationId: conversation.id,
//             providerMessageId: result.MessageId,
//             headers: {
//               "Reply-To": replyTo,
//               ...(usedInReplyTo ? { "In-Reply-To": usedInReplyTo } : {}),
//               ...(usedReferences ? { References: usedReferences } : {}),
//             },
//             sentAt: new Date(),
//             lastDeliveryStatus: "SENT",
//           },
//         });

//         // (Do NOT create EmailEvent for delivery/open here — SES -> SNS will insert those events.
//         // You may create a local "SENT" EmailEvent here if your UI expects an event row immediately,
//         // but be careful to dedupe with SNS events by snsMessageId. For now we rely on SNS.)
//       },
//       { timeout: 15000 }
//     );

//     res.json({
//       message: "Email sent",
//       leadId,
//       emailMessageId: queuedMessage.id,
//       messageId: result.MessageId,
//       replyTo,
//     });
//   } catch (err) {
//     next(err);
//   }
// }
