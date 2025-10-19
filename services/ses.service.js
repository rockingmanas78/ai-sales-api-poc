import {
  SESClient,
  VerifyDomainIdentityCommand,
  VerifyEmailIdentityCommand,
  GetIdentityVerificationAttributesCommand,
  SendEmailCommand,
  GetIdentityDkimAttributesCommand,
  VerifyDomainDkimCommand,
  SetIdentityDkimEnabledCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import { response } from "express";
import prisma from "../utils/prisma.client.js";

const ses = new SESClient({
  region: process.env.AWS_SES_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
    secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
  },
});

export async function verifyDomainIdentity(domainName) {
  const command = new VerifyDomainIdentityCommand({ Domain: domainName });
  const res = await ses.send(command);
  const dkimCommands = new VerifyDomainDkimCommand({ Domain: domainName });
  const { DkimTokens } = await ses.send(dkimCommands);

  let cnameRecords = DkimTokens.map((token) => ({
    name: `${token}._domainkey`,
    type: "CNAME",
    value: `${token}.dkim.amazonses.com`,
    ttl: 14400,
  }));

  cnameRecords.push({
    name: `_dmarc`,
    type: "TXT",
    value: "v=DMARC1; p=none;",
    ttl: 1800,
  });

  cnameRecords.push({
    name: "@",
    type: "TXT",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: 1800,
  });

  cnameRecords.push({
    type: "TXT",
    name: `_amazonses`,
    value: res.VerificationToken,
    ttl: 1800,
  });
  return { records: cnameRecords, token: res.VerificationToken };
}

export async function getDkimAttributes(identities) {
  const command = new GetIdentityDkimAttributesCommand({
    Identities: identities,
  });
  const response = await ses.send(command);
  console.log("Response", response);
  return response.DkimAttributes;
}

export async function enableDKIMSigning(domainName) {
  const command = new SetIdentityDkimEnabledCommand({
    Identity: domainName,
    DkimEnabled: true,
  });
  const response = await ses.send(command);
  return response;
}

export async function verifyEmailIdentity(emailAddress) {
  const cmd = new VerifyEmailIdentityCommand({ EmailAddress: emailAddress });
  return await ses.send(cmd);
}

export async function getIdentityVerificationAttributes(identities) {
  const cmd = new GetIdentityVerificationAttributesCommand({
    Identities: identities,
  });
  const res = await ses.send(cmd);
  return res.VerificationAttributes;
}

// Minimal MIME builder for HTML sends (adds arbitrary headers)
export async function sendRawEmailWithHeaders({
  fromEmail,
  toEmail,
  subject,
  htmlBody,
  replyTo, // single addr
  extraHeaders = {}, // e.g., { "In-Reply-To": "<...>", "References": "<...> ..." }
  configurationSetName = "identity-onboaring-for-tenants", // optional
  messageTags = [], // optional SES tags
}) {
  // Build headers (CRLF strictly per RFC 5322)
  const baseHeaders = {
    From: fromEmail,
    To: toEmail,
    Subject: subject,
    "MIME-Version": "1.0",
    "Content-Type": 'text/html; charset="UTF-8"',
    ...(replyTo ? { "Reply-To": replyTo } : {}),
    ...extraHeaders,
  };
  const headerLines = Object.entries(baseHeaders)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`);

  const raw = [
    ...headerLines,
    "", // blank line between headers and body
    htmlBody || "",
  ].join("\r\n");

  const cmd = new SendRawEmailCommand({
    RawMessage: { Data: new TextEncoder().encode(raw) },
    ...(configurationSetName && { ConfigurationSetName: configurationSetName }),
    ...(messageTags.length ? { Tags: messageTags } : {}),
  });
  // Note: SES overwrites Message-ID/Date; our threading headers remain. :contentReference[oaicite:1]{index=1}
  return await ses.send(cmd);
}

// services/ses.service.js
export async function sendEmail({
  fromEmail,
  toEmail,
  subject,
  htmlBody,
  configurationSetName = "identity-onboaring-for-tenants",
  replyToAddresses = [],
  messageTags = [],
}) {
  console.log("Sedning service hit", toEmail);
  const cmd = new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
    ReplyToAddresses: replyToAddresses, // ← SES classic supports this
    ConfigurationSetName: configurationSetName, // ← ensures events flow to your SNS destination
    Tags: messageTags, // ← Message tags
  });
  const mail = await ses.send(cmd);
  console.log("Email sent", mail);
  return mail;
}

export async function initiateSubdomainIdentity(subDomain, prefix) {
  // 1) Verify domain (TXT)
  const verifyCmd = new VerifyDomainIdentityCommand({ Domain: subDomain });
  const verifyRes = await ses.send(verifyCmd);
  const token = verifyRes.VerificationToken;

  // 2) Verify DKIM (CNAMEs)
  const dkimCmd = new VerifyDomainDkimCommand({ Domain: subDomain });
  const dkimRes = await ses.send(dkimCmd);
  const dkimTokens = dkimRes.DkimTokens || [];

  // 3) Assemble DNS records
  const records = [];

  // 3.1 TXT record for SES token
  records.push({
    name: `_amazonses.${prefix}`,
    type: "TXT",
    value: token,
    ttl: 1800,
  });

  // 3.2 CNAME records for DKIM
  dkimTokens.forEach((tok) => {
    records.push({
      name: `${tok}._domainkey.${prefix}`,
      type: "CNAME",
      value: `${tok}.dkim.amazonses.com`,
      ttl: 14400,
    });
  });

  // 3.3 DMARC record
  records.push({
    name: `_dmarc.${prefix}`,
    type: "TXT",
    value: "v=DMARC1; p=none;",
    ttl: 1800,
  });

  // 3.4 SPF record
  records.push({
    name: prefix,
    type: "TXT",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: 1800,
  });

  // 3.5 MX record for inbound mail
  const endpoint = `inbound-smtp.${
    process.env.AWS_REGION || "ap-south-1"
  }.amazonaws.com`;
  records.push({
    name: prefix,
    type: "MX",
    value: endpoint,
    ttl: 300,
  });

  return { records, token };
}

/**
 * Fetches SES verification status for one or more identities.
 * @param {string[]} identities
 * @returns {Promise<Record<string,{ VerificationStatus: string, VerificationToken?: string }>>}
 */
export async function getIdentityVerificationStatus(identities) {
  const cmd = new GetIdentityVerificationAttributesCommand({
    Identities: identities,
  });
  const res = await ses.send(cmd);
  return res.VerificationAttributes;
}

// Helpers
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function extractEmails(input) {
  const out = [];
  for (const item of asArray(input)) {
    if (typeof item !== "string") continue;
    const matches = item.match(EMAIL_RE);
    if (matches) out.push(...matches);
  }
  // de-dupe + lowercase domains (pragmatic)
  return [
    ...new Set(
      out.map((e) => {
        const [local, domain] = e.split("@");
        return `${local}@${(domain || "").toLowerCase()}`;
      })
    ),
  ];
}

// Accept `<id>` or plain; if array, use the last one like mail clients do.
function cleanMsgId(v) {
  if (!v) return null;
  let s = Array.isArray(v) ? String(v[v.length - 1]) : String(v);
  s = s.trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  return s || null;
}
function splitReferences(v) {
  // Accept array, comma/space separated string, with or without angle brackets
  const raw = Array.isArray(v) ? v.join(" ") : String(v || "");
  const ids = raw
    .split(/[,\s]+/)
    .map((x) => cleanMsgId(x))
    .filter(Boolean);
  return [...new Set(ids)];
}
function extractPlusTokenFromTo(toArr) {
  for (const addr of toArr) {
    const [local] = addr.split("@");
    const i = local.indexOf("+");
    if (i > -1) return local.slice(i + 1);
  }
  return null;
}

export async function processInbound(evt) {
  try {
    console.log("Inbound evt:", JSON.stringify(evt, null, 2));

    // ---- 0) Normalize addresses & headers
    const toEmails = extractEmails(evt.to);
    const fromEmails = extractEmails(evt.from);
    const headers = evt.headers || {};

    // ---- 1) Resolve tenant by inbound recipient domain
    const recipientDomain = (toEmails[0] || "").split("@")[1] || null;
    if (!recipientDomain) {
      console.warn("processInbound: no recipientDomain from 'to'");
      return;
    }

    console.log("Recipient domain", recipientDomain);

    const domainRow = await prisma.domainIdentity.findFirst({
      where: { domainName: recipientDomain, verificationStatus: "Success" },
      select: { tenantId: true },
    });
    if (!domainRow) {
      console.warn("processInbound: unknown inbound domain", recipientDomain);
      return;
    }
    const tenantId = domainRow.tenantId;

    // ---- 2) Threading signals
    const plusToken = extractPlusTokenFromTo(toEmails);

    const headerInReplyTo = headers["in-reply-to"] || headers["In-Reply-To"];
    const headerReferences = headers["references"] || headers["References"];

    const inReplyTo = cleanMsgId(evt.inReplyTo || headerInReplyTo);
    const referencesList = evt.references
      ? splitReferences(evt.references)
      : splitReferences(headerReferences);

    const referencesTail =
      referencesList && referencesList.length > 0
        ? referencesList[referencesList.length - 1]
        : null;

    // ---- 3) Provider message id for idempotency
    const headerMessageId = cleanMsgId(
      headers["message-id"] || headers["Message-ID"]
    );
    const computedProviderMessageId =
      evt.providerMessageId || evt?.s3?.objectKey || headerMessageId;

    if (!computedProviderMessageId) {
      console.warn(
        "processInbound: missing providerMessageId; skipping persist"
      );
      return;
    }

    // ---- 4) Choose preferred thread key (plusToken first)
    const fallbackKey = evt.subject
      ? `subj:${evt.subject}`
      : `msg:${computedProviderMessageId}`;

    const threadKeyPreferred =
      plusToken || inReplyTo || referencesTail || fallbackKey;

    // ---- 5) Compute participants (dedupe; exclude inbound sink domain)
    const participants = [
      ...new Set(
        [...fromEmails, ...toEmails].filter((email) => {
          const d = email.split("@")[1]?.toLowerCase();
          return d && d !== recipientDomain.toLowerCase();
        })
      ),
    ];

    console.log("Participants", participants);

    // ---- 6) Transactional upserts
    let conversationId; // we'll capture this for logging

    let inboundMessageId = null;
    await prisma.$transaction(
      async (tx) => {
        // (a) Upsert/merge Conversation by preferred key
        //     If there exists a convo under RFC keys (inReplyTo or referencesTail), migrate it to preferred.
        let conversation = await tx.conversation.findUnique({
          where: {
            tenantId_threadKey: { tenantId, threadKey: threadKeyPreferred },
          },
          select: { id: true, participants: true, subject: true },
        });

        console.log("Found conversation by preferred key?", conversation);

        if (!conversation) {
          const alternativeKey = inReplyTo || referencesTail;
          if (alternativeKey) {
            const alt = await tx.conversation.findUnique({
              where: {
                tenantId_threadKey: { tenantId, threadKey: alternativeKey },
              },
              select: { id: true, participants: true, subject: true },
            });
            if (alt) {
              // Merge/migrate alt → preferred (canonical) to avoid future splits
              const mergedParticipants = Array.from(
                new Set([...(alt.participants || []), ...participants])
              );
              const updated = await tx.conversation.update({
                where: { id: alt.id },
                data: {
                  threadKey: threadKeyPreferred,
                  subject: alt.subject ?? evt.subject ?? null,
                  participants: { set: mergedParticipants },
                  lastMessageAt: new Date(),
                  updatedAt: new Date(),
                },
                select: { id: true, participants: true, subject: true },
              });
              conversation = updated;
            }
          }
        }

        if (!conversation) {
          // Create new conversation under preferred key
          conversation = await tx.conversation.create({
            data: {
              tenantId,
              threadKey: threadKeyPreferred,
              subject: evt.subject ?? null,
              participants: Array.from(new Set(participants)),
              firstMessageAt: new Date(),
              lastMessageAt: new Date(),
            },
            select: { id: true, participants: true, subject: true },
          });
        } else {
          // Update existing: only set subject if not already set; always merge participants
          const mergedParticipants = Array.from(
            new Set([...(conversation.participants || []), ...participants])
          );
          await tx.conversation.update({
            where: { id: conversation.id },
            data: {
              ...(conversation.subject ? {} : { subject: evt.subject ?? null }),
              participants: { set: mergedParticipants },
              lastMessageAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }

        conversationId = conversation.id;

        // (b) Locate originating OUTBOUND message (for optional linkage)
        let originatingMessage = null;
        if (plusToken) {
          originatingMessage = await tx.emailMessage.findFirst({
            where: { tenantId, plusToken, direction: "OUTBOUND" },
            select: { id: true, campaignId: true, leadId: true },
          });
        }
        if (!originatingMessage && inReplyTo) {
          originatingMessage = await tx.emailMessage.findFirst({
            where: {
              tenantId,
              direction: "OUTBOUND",
              providerMessageId: inReplyTo, // <-- correct field
            },
            select: { id: true, campaignId: true, leadId: true },
          });
        }

        // (c) Idempotent INBOUND EmailMessage
        const inboundMessage = await tx.emailMessage.upsert({
          where: {
            tenantId_providerMessageId: {
              tenantId,
              providerMessageId: computedProviderMessageId,
            },
          },
          create: {
            tenantId,
            conversationId: conversation.id,
            direction: "INBOUND",
            provider: "AWS_SES",
            providerMessageId: computedProviderMessageId,
            subject: evt.subject || null,
            from: fromEmails,
            to: toEmails,
            cc: extractEmails(evt.cc),
            bcc: extractEmails(evt.bcc),
            text: evt.replyText || evt.fullText || null,
            html: evt.html || null,
            headers,
            verdicts: evt.verdicts || {},
            inReplyTo,
            referencesIds: referencesList || [],
            plusToken: plusToken || null,
            s3Bucket: evt?.s3?.bucket || null,
            s3Key: evt?.s3?.objectKey || null,
            receivedAt: new Date(),
            campaignId: originatingMessage?.campaignId || null,
            leadId: originatingMessage?.leadId || null,
          },
          update: {}, // idempotent
          // select: { id: true },
        });

        inboundMessageId = inboundMessage.id;

        // (d) Nothing else to write here; events pipeline (opens/clicks/etc.) handled by SES Events Lambda
      },
      { timeout: 15_000 }
    );

    console.log("processInbound: OK", {
      tenantId,
      conversationId,
      inboundMessageId,
    });
    return { tenantId, conversationId, inboundMessageId };
  } catch (err) {
    console.error("processInbound failed:", err);
  }
}