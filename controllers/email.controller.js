import { getSpamScore } from '../services/ai.service.js';
import * as emailService from '../services/email.service.js';
// controllers/send-via-lead.controller.js
import { PrismaClient } from '@prisma/client';
import { sendRawEmailWithHeaders, sendEmail as sesSendEmail } from '../services/ses.service.js';

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
    if (!emailBody || typeof emailBody !== 'string') {
      return res.status(400).json({ error: 'emailBody is required as a string' });
    }
        const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const score = await getSpamScore(emailBody, incomingAuth);
    res.json({ score });
  } catch (err) {
    next(err);
  }
}

export async function sendMailViaLead(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const {
      leadId,
      subject,
      htmlBody,
      fromEmail,
      conversationId,
      configurationSetName,    // optional if you keep a default
      campaignId: campaignIdInput, // optional
    } = req.body;

    if (!tenantId || !leadId || !subject || !htmlBody || !fromEmail) {
      return res.status(400).json({ error: 'tenantId, leadId, subject, htmlBody, fromEmail are required' });
    }

    // 1) Load lead and resolve recipient
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, contactEmail: true }
    });
    if (!lead) return res.status(404).json({ error: 'lead not found' });
    const toEmail = lead.contactEmail?.[0];
    if (!toEmail) return res.status(400).json({ error: 'lead has no contactEmail' });

    // 2) Ensure we have a campaign/template if not provided
    let campaignId = campaignIdInput || null;
    if (!campaignId) {
      // create (or reuse) a minimal template + campaign for direct sends
      const [template, campaign] = await prisma.$transaction(async (tx) => {
        // Try find any “Direct Send” template for this tenant to avoid sprawl
        let template = await tx.emailTemplate.findFirst({
          where: { tenantId, name: 'Direct Send (System)' },
          select: { id: true }
        });
        if (!template) {
          template = await tx.emailTemplate.create({
            data: {
              tenantId,
              name: 'Direct Send (System)',
              subject: 'Direct Send',
              body: '<p>{{body}}</p>',
              from: fromEmail,
              to: '{{lead.email}}'
            },
            select: { id: true }
          });
        }
        // Try find a campaign that uses it
        let campaign = await tx.emailCampaign.findFirst({
          where: { tenantId, name: 'Direct Send', templateId: template.id },
          select: { id: true }
        });
        if (!campaign) {
          campaign = await tx.emailCampaign.create({
            data: {
              tenantId,
              templateId: template.id,
              status: 'ACTIVE',
              name: 'Direct Send',
              description: 'Ad-hoc single sends',
              campaign_type: 'LEAD_NURTURING'
            },
            select: { id: true }
          });
        }
        return [template, campaign];
      });
      campaignId = campaign.id;
    }

    // 3) Create EmailLog (queued) to mint a stable id as plus-token
    const emailLog = await prisma.emailLog.create({
      data: {
        tenantId,
        campaignId,
        leadId,
        status: 'QUEUED',
        senderEmail: fromEmail,
        recipientEmails: [toEmail],
        subject,
        content: htmlBody,
        createdAt: new Date()
      }
    });

    // 4) Resolve inbound subdomain for this tenant
    const inbound = await prisma.domainIdentity.findFirst({
      where: {
        tenantId,
        domainName: { startsWith: 'inbound.' },
        verificationStatus: 'Success'
      },
      select: { domainName: true }
    });
    if (!inbound) return res.status(400).json({ error: 'Inbound subdomain not verified for this tenant' });

    let replyToToken = emailLog.id;
         // If conversationId is provided, RE-USE its threadKey so all follow-ups stay in one conversation.
    let existingConversation = null;
    if (conversationId) {
      existingConversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true, threadKey: true }
      });
      if (!existingConversation) {
        return res.status(404).json({ error: 'conversation not found for this tenant' });
      }
      replyToToken = existingConversation.threadKey; // reuse original token
    }
    const replyTo = `reply+${replyToToken}@${inbound.domainName}`;

     // 5) Decide how to send:
     //    - NEW follow-up path: if conversationId provided, add RFC threading headers and use RAW send.
     //    - Otherwise, use simple SendEmail (no extra headers needed).
     let result, usedInReplyTo = null, usedReferences = null;
     if (existingConversation) {
       // find last message in the conversation (prefer OUTBOUND, else any)
       const last = await prisma.emailMessage.findFirst({
         where: { tenantId, conversationId: existingConversation.id },
         orderBy: { createdAt: 'desc' },
         select: { providerMessageId: true, headers: true }
       });
       // Try to get the prior RFC Message-ID header; fallback to SES id synthesized
       const lastHeaderMsgId =
         (last?.headers && (last.headers['Message-ID'] || last.headers['message-id'])) || null;
       const regionHost = `${process.env.AWS_SES_REGION || 'ap-south-1'}.amazonses.com`;
       const priorRef = lastHeaderMsgId
         ? lastHeaderMsgId
         : (last?.providerMessageId ? `<${last.providerMessageId}@${regionHost}>` : null);
       const extraHeaders = {};
       if (priorRef) {
         usedInReplyTo = priorRef;
         usedReferences = priorRef;
         extraHeaders["In-Reply-To"] = priorRef;
         extraHeaders["References"]  = priorRef;
       }
       // RAW send to add custom headers (Reply-To   threading headers) :contentReference[oaicite:4]{index=4}
       result = await sendRawEmailWithHeaders({
         fromEmail,
         toEmail,
         subject,
         htmlBody,
         replyTo,
         extraHeaders,
         configurationSetName: configurationSetName || process.env.SES_CONFIGURATION_SET,
         messageTags: [
           { Name: 'tenantId',  Value: tenantId },
           { Name: 'emailLogId', Value: emailLog.id }
         ]
       });
     } else {
       // First message in a new thread — simple send is fine
       result = await sesSendEmail({
         fromEmail,
         toEmail,
         subject,
         htmlBody,
         configurationSetName: configurationSetName || process.env.SES_CONFIGURATION_SET,
         replyToAddresses: [replyTo],
         messageTags: [
           { Name: 'tenantId',  Value: tenantId },
           { Name: 'emailLogId', Value: emailLog.id }
         ]
       });
     }

    // 6) DB transaction: upsert Conversation, create OUTBOUND EmailMessage, mark EmailLog SENT
    await prisma.$transaction(async (tx) => {
      const threadKey = replyToToken;
 
        const conversation = existingConversation
          ? await tx.conversation.update({
             where: { id: existingConversation.id },
             data: {
               subject: { set: subject },
               participants: {
                 set: Array.from(new Set([
                   fromEmail,
                   toEmail,
                   ...((await tx.conversation.findUnique({
                     where: { id: existingConversation.id },
                     select: { participants: true }
                   }))?.participants || [])
                 ]))
               },
               lastMessageAt: new Date()
             }
           })
         : await tx.conversation.upsert({
        where: { tenantId_threadKey: { tenantId, threadKey } },
        create: {
          tenantId,
          threadKey,
          subject,
          participants: [fromEmail, toEmail]
        },
        update: {
          subject: { set: subject },
          participants: {
            set: Array.from(new Set([
              fromEmail,
              toEmail,
              ...((await tx.conversation.findUnique({
                where: { tenantId_threadKey: { tenantId, threadKey } },
                select: { participants: true }
              }))?.participants || [])
            ]))
          },
          lastMessageAt: new Date()
        }
      });

      await tx.emailMessage.upsert({
        where: { tenantId_providerMessageId: { tenantId, providerMessageId: result.MessageId } },
        create: {
          tenantId,
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          provider: 'AWS_SES',
          providerMessageId: result.MessageId,
          subject,
          from: [fromEmail],
          to: [toEmail],
          html: htmlBody,
          headers: {
            'Reply-To': replyTo,
            ...(usedInReplyTo ? { 'In-Reply-To': usedInReplyTo } : {}),
            ...(usedReferences ? { 'References': usedReferences } : {})
          },
          verdicts: {},
          plusToken: replyToToken,
          sentAt: new Date(),
          campaignId,
          leadId,
          emailLogId: emailLog.id
        },
        update: {}
      });

      await tx.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: result.MessageId,
          outboundMessageId: result.MessageId,
          replyToToken
        }
      });
    }, { timeout: 15000 });

    res.json({
      message: 'Email sent',
      leadId,
      emailLogId: emailLog.id,
      messageId: result.MessageId,
      replyTo
    });
  } catch (err) {
    next(err);
  }
}
