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

// export async function processInbound(evt) {
//   try {
//     console.log("Inbound evt:", JSON.stringify(evt, null, 2));

//     // Normalize addresses first (your Lambda POSTS arrays, but harden for strings)
//     const toEmails = extractEmails(evt.to);
//     const fromEmails = extractEmails(evt.from);

//     // 1) Resolve tenant by inbound domain (first "to" addr)
//     const recipientDomain = (toEmails[0] || "").split("@")[1] || null;
//     if (!recipientDomain) {
//       console.warn("processInbound: no recipientDomain");
//       return; // DO NOT use res here
//     }

//     const domain = await prisma.domainIdentity.findFirst({
//       where: { domainName: recipientDomain, verificationStatus: "Success" },
//       select: { tenantId: true },
//     });
//     if (!domain) {
//       console.warn("processInbound: unknown inbound domain", recipientDomain);
//       return;
//     }
//     const tenantId = domain.tenantId;

//     // 2) Locate originating EmailLog (plus-token first, RFC header next)
//     const plusToken = extractPlusTokenFromTo(toEmails);

//     // in-reply-to / references can be in evt fields or headers
//     const hdrs = evt.headers || {};
//     const hdrInReplyTo = hdrs["in-reply-to"] || hdrs["In-Reply-To"];
//     const hdrRefs = hdrs["references"] || hdrs["References"];

//     const inReplyTo = cleanMsgId(evt.inReplyTo || hdrInReplyTo);
//     const references = evt.references
//       ? splitReferences(evt.references)
//       : splitReferences(hdrRefs);

//     // Try plus-token first
//     let originatingMessage = null;
//     if (plusToken) {
//       originatingMessage = await prisma.emailMessage.findFirst({
//         where: { tenantId, plusToken },
//       });
//     }

//     // fallback to RFC threading header
//     if (!originatingMessage && inReplyTo) {
//       originatingMessage = await prisma.emailMessage.findFirst({
//         where: { tenantId, outboundMessageId: inReplyTo },
//       });
//     }

//     // 3) Thread key (RFC 5322 first; fallback to plus-token; else subj)
//     const refTail = references.length
//       ? references[references.length - 1]
//       : null;
//     const key = evt.providerMessageId || evt?.s3?.objectKey || "unknown";
//     //const threadKey = inReplyTo || refTail || plusToken || (evt.subject ? `subj:${evt.subject}` : `msg:${key}`);
//     const threadKeyPreferred =
//       plusToken ||
//       inReplyTo ||
//       refTail ||
//       (evt.subject ? `subj:${evt.subject}` : `msg:${providerMessageId}`);

//     // Participants: deduped from and to; drop your system inbound alias
//     // const participants = [...new Set(
//     //   [...fromEmails, ...toEmails].filter(e => !e.endsWith(`@${INBOUND_ROOT}`))
//     // )];

//     const participants = [
//       ...new Set(
//         [...fromEmails, ...toEmails].filter((e) => {
//           const d = e.split("@")[1]?.toLowerCase();
//           return d && d !== recipientDomain?.toLowerCase(); // exclude only the event’s inbound domain
//         })
//       ),
//     ];

//     console.log("Participants", participants);

//     // // 4) Upsert/find Conversation
//     // let conversation = await prisma.conversation.findFirst({ where: { tenantId, threadKey } });
//     // if (!conversation) {
//     //   conversation = await prisma.conversation.create({
//     //     data: {
//     //       tenantId,
//     //       threadKey,
//     //       subject: evt.subject || null,
//     //       participants
//     //     }
//     //   });
//     // } else {
//     //   await prisma.conversation.update({
//     //     where: { id: conversation.id },
//     //     data: {
//     //       subject: conversation.subject ?? evt.subject ?? null,
//     //       participants: [...new Set([...(conversation.participants || []), ...participants])],
//     //       lastMessageAt: new Date()
//     //     }
//     //   });
//     // }

//     // // 5) Idempotent persist inbound EmailMessage
//     // // Prefer SES S3 action pointer (authoritative); else message-id header
//     // const hdrMsgId = cleanMsgId(hdrs['message-id'] || hdrs['Message-ID']);
//     // const providerMessageId = evt.providerMessageId || evt?.s3?.objectKey || hdrMsgId;

//     // if (!providerMessageId) {
//     //   console.warn('processInbound: no providerMessageId; not creating EmailMessage');
//     //   return;
//     // }

//     // const exists = await prisma.emailMessage.findFirst({
//     //   where: { tenantId, providerMessageId }
//     // });
//     // if (!exists) {
//     //   await prisma.emailMessage.create({
//     //     data: {
//     //       tenantId,
//     //       conversationId: conversation.id,
//     //       direction: 'INBOUND',
//     //       provider: 'AWS_SES',
//     //       providerMessageId,
//     //       subject: evt.subject || null,
//     //       from: fromEmails,
//     //       to: toEmails,
//     //       cc: extractEmails(evt.cc),
//     //       bcc: extractEmails(evt.bcc),
//     //       text: evt.replyText || evt.fullText || null,
//     //       html: evt.html || null,
//     //       headers: hdrs,
//     //       verdicts: evt.verdicts || {},
//     //       inReplyTo,
//     //       referencesIds: references,
//     //       plusToken: plusToken || null,
//     //       s3Bucket: evt?.s3?.bucket || null,
//     //       s3Key: evt?.s3?.objectKey || null,
//     //       receivedAt: new Date(),
//     //       campaignId: emailLog?.campaignId || null,
//     //       leadId: emailLog?.leadId || null,
//     //       emailLogId: emailLog?.id || null
//     //     }
//     //   });
//     // }

//     // // 6) Flip originating EmailLog to REPLIED
//     // if (emailLog) {
//     //   await prisma.emailLog.update({
//     //     where: { id: emailLog.id },
//     //     data: { status: 'REPLIED', repliedAt: new Date() }
//     //   });
//     // }
//     // --- transactional, fast, idempotent DB writes only ---
//     let conversationId; // we'll capture this for logging
//     await prisma.$transaction(
//       async (tx) => {
//         // (a) find-by-preferred key (plusToken) OR merge an existing RFC-key convo into it
//         let conv = await tx.conversation.findUnique({
//           where: {
//             tenantId_threadKey: { tenantId, threadKey: threadKeyPreferred },
//           },
//           select: { id: true, participants: true },
//         });

//         if (!conv) {
//           // If we didn’t find by plusToken (or fallback), but we DO have an RFC key, try that,
//           // then migrate its key to the preferred plusToken to avoid future splits.
//           const altKey = (inReplyTo || refTail) ?? null;
//           if (altKey) {
//             const alt = await tx.conversation.findUnique({
//               where: { tenantId_threadKey: { tenantId, threadKey: altKey } },
//               select: { id: true, participants: true },
//             });
//             if (alt) {
//               // merge: move the thread to the preferred key (plusToken) as canonical
//               await tx.conversation.update({
//                 where: { id: alt.id },
//                 data: {
//                   threadKey: threadKeyPreferred,
//                   subject: evt.subject ?? undefined,
//                   participants: {
//                     set: Array.from(
//                       new Set([...(alt.participants || []), ...participants])
//                     ),
//                   },
//                   lastMessageAt: new Date(),
//                 },
//               });
//               conv = { id: alt.id, participants: alt.participants };
//             }
//           }
//         }

//         // If still not found, create with the preferred key
//         if (!conv) {
//           const created = await tx.conversation.create({
//             data: {
//               tenantId,
//               threadKey: threadKeyPreferred,
//             },
//           });
//           conv = { id: created.id, participants: created.participants };
//         } else {
//           // update subject/participants if needed
//           await tx.conversation.update({
//             where: { id: conv.id },
//             data: {
//               subject: { set: evt.subject ?? undefined },
//               participants: {
//                 set: Array.from(
//                   new Set([...(conv.participants || []), ...participants])
//                 ),
//               },
//               lastMessageAt: new Date(),
//             },
//           });
//         }

//         // (b) Link originating EmailMessage first (plus-token preferred, then RFC headers)
//         let originatingMessage = null;
//         if (plusToken) {
//           originatingMessage = await tx.emailMessage.findFirst({
//             where: { tenantId, plusToken },
//           });
//         }

//         if (!originatingMessage && inReplyTo) {
//           originatingMessage = await tx.emailMessage.findFirst({
//             where: { tenantId, outboundMessageId: inReplyTo },
//           });
//         }

//         // (c) Create inbound EmailMessage idempotently
//         const inboundMessage = await tx.emailMessage.upsert({
//           where: {
//             tenantId_providerMessageId: { tenantId, providerMessageId },
//           },
//           create: {
//             tenantId,
//             conversationId: conv.id,
//             direction: "INBOUND",
//             provider: "AWS_SES",
//             providerMessageId,
//             subject: evt.subject || null,
//             from: fromEmails,
//             to: toEmails,
//             cc: extractEmails(evt.cc),
//             bcc: extractEmails(evt.bcc),
//             text: evt.replyText || evt.fullText || null,
//             html: evt.html || null,
//             headers: hdrs,
//             verdicts: evt.verdicts || {},
//             inReplyTo,
//             referencesIds: references,
//             plusToken: plusToken || null,
//             s3Bucket: evt?.s3?.bucket || null,
//             s3Key: evt?.s3?.objectKey || null,
//             receivedAt: new Date(),
//             campaignId: originatingMessage?.campaignId || null,
//             leadId: originatingMessage?.leadId || null,
//           },
//           update: {}, // idempotent
//         });

//         // (d) Instead of mutating emailLog, log reply event
//         if (originatingMessage) {
//           await tx.emailEvent.create({
//             data: {
//               tenantId,
//               emailMessageId: inboundMessage.id, // link to the inbound message
//               type: "REPLIED",
//               createdAt: new Date(),
//               campaignId: originatingMessage.campaignId ?? null,
//               leadId: originatingMessage.leadId ?? null,
//             },
//           });
//         }

//         conversationId = conv.id;
//       },
//       { timeout: 15_000 }
//     );

//     console.log("processInbound: OK", {
//       tenantId,
//       conversationId,
//     });
//   } catch (err) {
//     console.error("processInbound failed:", err);
//   }
// }
