import {
  SESClient,
  VerifyDomainIdentityCommand,
  VerifyEmailIdentityCommand,
  GetIdentityVerificationAttributesCommand,
  SendEmailCommand,
  GetIdentityDkimAttributesCommand,
  VerifyDomainDkimCommand,
  SetIdentityDkimEnabledCommand,
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
    ttl: 14400
  }));

  cnameRecords.push({
    name: `_dmarc`,
    type: "TXT",
    value: "v=DMARC1; p=none;",
    ttl: 1800
  });

  cnameRecords.push({
    name: "@",
    type: "TXT",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: 1800
  });

  cnameRecords.push({
    type: "TXT",
    name: `_amazonses`,
    value: res.VerificationToken,
    ttl: 1800
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

// export async function sendEmail({
//   fromEmail,
//   toEmail,
//   subject,
//   htmlBody,
//   configurationSetName
// }) {
//   const cmd = new SendEmailCommand({
//     Source: fromEmail,                       // ← now dynamic
//     Destination: { ToAddresses: [toEmail] },
//     Message: {
//       Subject: { Data: subject, Charset: "UTF-8" },
//       Body:    { Html:   { Data: htmlBody, Charset: "UTF-8" } }
//     },
//     ...(configurationSetName && { ConfigurationSetName: configurationSetName })
//   });

//   let res = await ses.send(cmd);
//   return res;
// }
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
  return await ses.send(cmd);
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
      ttl: 14400
    });
  });

  // 3.3 DMARC record
  records.push({
    name: `_dmarc.${prefix}`,
    type: "TXT",
    value: "v=DMARC1; p=none;",
    ttl: 1800
  });

  // 3.4 SPF record
  records.push({
    name: prefix,
    type: "TXT",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: 1800
  });

  // 3.5 MX record for inbound mail
  const endpoint = `inbound-smtp.${
    process.env.AWS_REGION || "ap-south-1"
  }.amazonaws.com`;
  records.push({
    name: prefix,
    type: "MX",
    value: endpoint,
    ttl: 300
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
const asArray = (x) => (Array.isArray(x) ? x : (x == null ? [] : [x]));
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;

function extractEmails(input) {
  const out = [];
  for (const item of asArray(input)) {
    if (typeof item !== 'string') continue;
    const matches = item.match(EMAIL_RE);
    if (matches) out.push(...matches);
  }
  // de-dupe + lowercase domains (pragmatic)
  return [...new Set(out.map(e => {
    const [local, domain] = e.split('@');
    return `${local}@${(domain || '').toLowerCase()}`;
  }))];
}

// Accept `<id>` or plain; if array, use the last one like mail clients do.
function cleanMsgId(v) {
  if (!v) return null;
  let s = Array.isArray(v) ? String(v[v.length - 1]) : String(v);
  s = s.trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return s || null;
}
function splitReferences(v) {
  // Accept array, comma/space separated string, with or without angle brackets
  const raw = Array.isArray(v) ? v.join(' ') : String(v || '');
  const ids = raw
    .split(/[,\s]+/)
    .map(x => cleanMsgId(x))
    .filter(Boolean);
  return [...new Set(ids)];
}
function extractPlusTokenFromTo(toArr) {
  for (const addr of toArr) {
    const [local] = addr.split('@');
    const i = local.indexOf('+');
    if (i > -1) return local.slice(i + 1);
  }
  return null;
}

export async function processInbound(evt) {
  try {
    console.log('Inbound evt:', JSON.stringify(evt, null, 2));

    // Normalize addresses first (your Lambda POSTS arrays, but harden for strings)
    const toEmails   = extractEmails(evt.to);
    const fromEmails = extractEmails(evt.from);

    // 1) Resolve tenant by inbound domain (first "to" addr)
    const recipientDomain = (toEmails[0] || '').split('@')[1] || null;
    if (!recipientDomain) {
      console.warn('processInbound: no recipientDomain');
      return; // DO NOT use res here
    }

    const domain = await prisma.domainIdentity.findFirst({
      where: { domainName: recipientDomain, verificationStatus: 'Success' },
      select: { tenantId: true }
    });
    if (!domain) {
      console.warn('processInbound: unknown inbound domain', recipientDomain);
      return;
    }
    const tenantId = domain.tenantId;

    // 2) Locate originating EmailLog (plus-token first, RFC header next)
    const plusToken = extractPlusTokenFromTo(toEmails);

    let emailLog = null;
    if (plusToken) {
      emailLog = await prisma.emailLog.findFirst({ where: { tenantId, id: plusToken } });
    }

    // in-reply-to / references can be in evt fields or headers
    const hdrs = evt.headers || {};
    const hdrInReplyTo = hdrs['in-reply-to'] || hdrs['In-Reply-To'];
    const hdrRefs      = hdrs['references']  || hdrs['References'];

    const inReplyTo   = cleanMsgId(evt.inReplyTo || hdrInReplyTo);
    const references  = evt.references ? splitReferences(evt.references) : splitReferences(hdrRefs);

    if (!emailLog && inReplyTo) {
      emailLog = await prisma.emailLog.findFirst({ where: { tenantId, outboundMessageId: inReplyTo } });
    }

    // 3) Thread key (RFC 5322 first; fallback to plus-token; else subj)
    const refTail  = references.length ? references[references.length - 1] : null;
    const key = evt.providerMessageId || evt?.s3?.objectKey || "unknown";
    const threadKey = inReplyTo || refTail || plusToken || (evt.subject ? `subj:${evt.subject}` : `msg:${key}`);

    // Participants: deduped from and to; drop your system inbound alias
    // const participants = [...new Set(
    //   [...fromEmails, ...toEmails].filter(e => !e.endsWith(`@${INBOUND_ROOT}`))
    // )];

    const participants = [...new Set(
      [...fromEmails, ...toEmails].filter(e => {
        const d = e.split('@')[1]?.toLowerCase();
        return d && d !== recipientDomain?.toLowerCase(); // exclude only the event’s inbound domain
      })
    )];

    console.log("Participants", participants);

    // 4) Upsert/find Conversation
    let conversation = await prisma.conversation.findFirst({ where: { tenantId, threadKey } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          threadKey,
          subject: evt.subject || null,
          participants
        }
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          subject: conversation.subject ?? evt.subject ?? null,
          participants: [...new Set([...(conversation.participants || []), ...participants])],
          lastMessageAt: new Date()
        }
      });
    }

    // 5) Idempotent persist inbound EmailMessage
    // Prefer SES S3 action pointer (authoritative); else message-id header
    const hdrMsgId = cleanMsgId(hdrs['message-id'] || hdrs['Message-ID']);
    const providerMessageId = evt.providerMessageId || evt?.s3?.objectKey || hdrMsgId;

    if (!providerMessageId) {
      console.warn('processInbound: no providerMessageId; not creating EmailMessage');
      return;
    }

    const exists = await prisma.emailMessage.findFirst({
      where: { tenantId, providerMessageId }
    });
    if (!exists) {
      await prisma.emailMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          provider: 'AWS_SES',
          providerMessageId,
          subject: evt.subject || null,
          from: fromEmails,
          to: toEmails,
          cc: extractEmails(evt.cc),
          bcc: extractEmails(evt.bcc),
          text: evt.replyText || evt.fullText || null,
          html: evt.html || null,
          headers: hdrs,
          verdicts: evt.verdicts || {},
          inReplyTo,
          referencesIds: references,
          plusToken: plusToken || null,
          s3Bucket: evt?.s3?.bucket || null,
          s3Key: evt?.s3?.objectKey || null,
          receivedAt: new Date(),
          campaignId: emailLog?.campaignId || null,
          leadId: emailLog?.leadId || null,
          emailLogId: emailLog?.id || null
        }
      });
    }

    // 6) Flip originating EmailLog to REPLIED
    if (emailLog) {
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: 'REPLIED', repliedAt: new Date() }
      });
    }

    console.log('processInbound: OK', { tenantId, conversationId: conversation.id, emailLogId: emailLog?.id || null });
  } catch (err) {
    console.error('processInbound failed:', err);
  }
}

// export async function processInbound(evt) {
//   console.log("Event", evt);
//   // evt carries: providerMessageId, subject, from[], to[], replyText, fullText, html,
//   // headers, verdicts{spf,dkim,dmarc}, s3{bucket,objectKey}, inReplyTo, references

//   // 1) Resolve tenant by inbound domain
//   const recipientDomain = (evt.to?.[0] || "").split("@")[1] || null;
//   if (!recipientDomain)
//     return { error: "no recipient domain" };

//   const domain = await prisma.domainIdentity.findFirst({
//     where: { domainName: recipientDomain, verificationStatus: "Success" },
//     select: { tenantId: true },
//   });
//   if (!domain) return { error: "unknown inbound domain" };

//   console.log("Domain", domain);
//   const tenantId = domain.tenantId;

//   // 2) Extract plus-token from any of the recipient addresses (reply+<token>@...)
//   const plusToken = (() => {
//     for (const addr of evt.to || []) {
//       const local = addr.split("@")[0] || "";
//       const p = local.indexOf("+");
//       if (p > -1) return local.slice(p + 1);
//     }
//     return null;
//   })();

//   // 3) Try to locate the originating EmailLog (plus-token first, RFC header next)
//   let emailLog = null;
//   if (plusToken) {
//     emailLog = await prisma.emailLog.findFirst({
//       where: { tenantId, id: plusToken },
//     });
//   }
//   if (!emailLog && evt.inReplyTo) {
//     emailLog = await prisma.emailLog.findFirst({
//       where: { tenantId, outboundMessageId: evt.inReplyTo },
//     });
//   }

//   console.log("Email log", emailLog);

//   // 4) Compute threadKey: In-Reply-To (or last reference) -> plusToken -> fallback
//   const refTail =
//     Array.isArray(evt.references) && evt.references.length
//       ? evt.references[evt.references.length - 1]
//       : typeof evt.references === "string"
//       ? evt.references
//       : null;

//   const threadKey =
//     evt.inReplyTo ||
//     refTail ||
//     plusToken ||
//     (evt.subject ? `subj:${evt.subject}` : `msg:${evt.providerMessageId}`);
//   console.log("Thread key", threadKey);

//   // 5) Upsert/find Conversation
//   let conversation = await prisma.conversation.findFirst({
//     where: { tenantId, threadKey },
//   });
//   if (!conversation) {
//     conversation = await prisma.conversation.create({
//       data: {
//         tenantId,
//         threadKey,
//         subject: evt.subject || null,
//         participants: Array.from(
//           new Set([...(evt.from || []), ...(evt.to || [])])
//         ),
//       },
//     });
//   } else {
//     await prisma.conversation.update({
//       where: { id: conversation.id },
//       data: {
//         subject: conversation.subject ?? evt.subject ?? null,
//         participants: Array.from(
//           new Set([
//             ...(conversation.participants || []),
//             ...(evt.from || []),
//             ...(evt.to || []),
//           ])
//         ),
//         lastMessageAt: new Date(),
//       },
//     });
//   }

//   console.log("Conversation", conversation);

//   // 6) Idempotent persist inbound EmailMessage by (tenantId, providerMessageId)
//   const providerMessageId = evt.providerMessageId || evt.s3?.objectKey;
//   if (!providerMessageId)
//     return { error: "no providerMessageId" };

//   const existing = await prisma.emailMessage.findFirst({
//     where: { tenantId, providerMessageId },
//   });

//   if (!existing) {
//     console.log("not existing");
//     await prisma.emailMessage.create({
//       data: {
//         tenantId,
//         conversationId: conversation.id,
//         direction: "INBOUND",
//         provider: "AWS_SES",
//         providerMessageId,
//         subject: evt.subject || null,
//         from: evt.from || [],
//         to: evt.to || [],
//         cc: [],
//         bcc: [],
//         text: evt.replyText || evt.fullText || null,
//         html: evt.html || null,
//         headers: evt.headers || {},
//         verdicts: evt.verdicts || {},
//         inReplyTo: evt.inReplyTo || null,
//         referencesIds: Array.isArray(evt.references)
//           ? evt.references
//           : evt.references
//           ? [evt.references]
//           : [],
//         plusToken: plusToken || null,
//         s3Bucket: evt.s3?.bucket || null,
//         s3Key: evt.s3?.objectKey || null,
//         receivedAt: new Date(),
//         // Optionally link back
//         campaignId: emailLog?.campaignId || null,
//         leadId: emailLog?.leadId || null,
//         emailLogId: emailLog?.id || null,
//       },
//     });
//   }

//   // 7) Flip originating EmailLog to REPLIED
//   if (emailLog) {
//     console.log("Creating email log");
//     await prisma.emailLog.update({
//       where: { id: emailLog.id },
//       data: { status: "REPLIED", repliedAt: new Date() },
//     });
//   }

//   console.log("Done");

//   return {
//     ok: true,
//     tenantId,
//     conversationId: conversation.id,
//     emailLogId: emailLog?.id || null,
//   };
// }
