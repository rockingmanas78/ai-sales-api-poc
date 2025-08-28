import {
    SESClient,
    VerifyDomainIdentityCommand,
    VerifyEmailIdentityCommand,
    GetIdentityVerificationAttributesCommand,
    SendEmailCommand,
    GetIdentityDkimAttributesCommand,
    VerifyDomainDkimCommand,
    SetIdentityDkimEnabledCommand,
} from '@aws-sdk/client-ses';
import { response } from 'express';
import prisma from '../utils/prisma.client.js';

const ses = new SESClient({
    region: process.env.AWS_SES_REGION || 'ap-south-1',
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

  let cnameRecords = DkimTokens.map(token => ({
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
  })

  cnameRecords.push({
      name: '@',
      type: "TXT",
      value: "v=spf1 include:amazonses.com ~all",
      ttl: 1800,
    });

  cnameRecords.push({
    type: 'TXT',
    name: `_amazonses`,
    value: res.VerificationToken,
    ttl: 1800
  })
  return {records: cnameRecords, token: res.VerificationToken };
}

export async function getDkimAttributes(identities) {
  const command = new GetIdentityDkimAttributesCommand({ Identities: identities });
  const response = await ses.send(command);
  console.log("Response", response);
  return response.DkimAttributes;
}

export async function enableDKIMSigning(domainName) {
  const command = new SetIdentityDkimEnabledCommand({ Identity: domainName, DkimEnabled: true })
  const response = await ses.send(command);
  return response;
}

export async function verifyEmailIdentity(emailAddress) {
  const cmd = new VerifyEmailIdentityCommand({ EmailAddress: emailAddress });
  return await ses.send(cmd);
}

export async function getIdentityVerificationAttributes(identities) {
  const cmd = new GetIdentityVerificationAttributesCommand({ Identities: identities });
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
  configurationSetName,
  replyToAddresses = [],
  messageTags = []
}) {
  const cmd = new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body:    { Html:   { Data: htmlBody, Charset: "UTF-8" } }
    },
    ReplyToAddresses: replyToAddresses,      // ← SES classic supports this
    ConfigurationSetName: configurationSetName, // ← ensures events flow to your SNS destination
    Tags: messageTags                        // ← Message tags
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
    name:  `_amazonses.${prefix}`,
    type:  'TXT',
    value: token,
    ttl:   1800,
  });

  // 3.2 CNAME records for DKIM
  dkimTokens.forEach(tok => {
    records.push({
      name:  `${tok}._domainkey.${prefix}`,
      type:  'CNAME',
      value: `${tok}.dkim.amazonses.com`,
      ttl:   14400,
    });
  });

  // 3.3 DMARC record
  records.push({
    name:  `_dmarc.${prefix}`,
    type:  'TXT',
    value: 'v=DMARC1; p=none;',
    ttl:   1800,
  });

  // 3.4 SPF record
  records.push({
    name:  prefix,
    type:  'TXT',
    value: 'v=spf1 include:amazonses.com ~all',
    ttl:   1800,
  });

  // 3.5 MX record for inbound mail
  const endpoint = `inbound-smtp.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`;
  records.push({
    name:  prefix,
    type:  'MX',
    value: endpoint,
    ttl:   300,
  });

  return { records, token };
}

/**
 * Fetches SES verification status for one or more identities.
 * @param {string[]} identities
 * @returns {Promise<Record<string,{ VerificationStatus: string, VerificationToken?: string }>>}
 */
export async function getIdentityVerificationStatus(identities) {
  const cmd = new GetIdentityVerificationAttributesCommand({ Identities: identities });
  const res = await ses.send(cmd);
  return res.VerificationAttributes;
}

export async function processInbound(evt) {

    console.log("Event", evt);
    // evt carries: providerMessageId, subject, from[], to[], replyText, fullText, html,
    // headers, verdicts{spf,dkim,dmarc}, s3{bucket,objectKey}, inReplyTo, references

    // 1) Resolve tenant by inbound domain
    const recipientDomain = (evt.to?.[0] || "").split("@")[1] || null;
    if (!recipientDomain) return res.status(400).json({ error: "no recipient domain" });

    const domain = await prisma.domainIdentity.findFirst({
      where: { domainName: recipientDomain, verificationStatus: "Success" },
      select: { tenantId: true }
    });
    if (!domain) return res.status(400).json({ error: "unknown inbound domain" });

    console.log("Domain",domain);
    const tenantId = domain.tenantId;

    // 2) Extract plus-token from any of the recipient addresses (reply+<token>@...)
    const plusToken = (() => {
      for (const addr of evt.to || []) {
        const local = addr.split("@")[0] || "";
        const p = local.indexOf("+");
        if (p > -1) return local.slice(p + 1);
      }
      return null;
    })();

    // 3) Try to locate the originating EmailLog (plus-token first, RFC header next)
    let emailLog = null;
    if (plusToken) {
      emailLog = await prisma.emailLog.findFirst({ where: { tenantId, id: plusToken } });
    }
    if (!emailLog && evt.inReplyTo) {
      emailLog = await prisma.emailLog.findFirst({ where: { tenantId, outboundMessageId: evt.inReplyTo } });
    }

    console.log("Email log", emailLog);

    // 4) Compute threadKey: In-Reply-To (or last reference) -> plusToken -> fallback
    const refTail =
      Array.isArray(evt.references) && evt.references.length
        ? evt.references[evt.references.length - 1]
        : (typeof evt.references === "string" ? evt.references : null);

    const threadKey = evt.inReplyTo || refTail || plusToken || (evt.subject ? `subj:${evt.subject}` : `msg:${evt.providerMessageId}`);
    console.log("Thread key", threadKey);

    // 5) Upsert/find Conversation
    let conversation = await prisma.conversation.findFirst({
      where: { tenantId, threadKey }
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          threadKey,
          subject: evt.subject || null,
          participants: Array.from(new Set([...(evt.from || []), ...(evt.to || [])])),
        }
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          subject: conversation.subject ?? evt.subject ?? null,
          participants: Array.from(new Set([...(conversation.participants || []), ...(evt.from || []), ...(evt.to || [])])),
          lastMessageAt: new Date()
        }
      });
    }

    console.log("Conversation", conversation);

    // 6) Idempotent persist inbound EmailMessage by (tenantId, providerMessageId)
    const providerMessageId = evt.providerMessageId || evt.s3?.objectKey;
    if (!providerMessageId) return res.status(400).json({ error: "no providerMessageId" });

    const existing = await prisma.emailMessage.findFirst({
      where: { tenantId, providerMessageId }
    });

    if (!existing) {
      console.log("not existing");
      await prisma.emailMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          direction: "INBOUND",
          provider: "AWS_SES",
          providerMessageId,
          subject: evt.subject || null,
          from: evt.from || [],
          to: evt.to || [],
          cc: [],
          bcc: [],
          text: evt.replyText || evt.fullText || null,
          html: evt.html || null,
          headers: evt.headers || {},
          verdicts: evt.verdicts || {},
          inReplyTo: evt.inReplyTo || null,
          referencesIds: Array.isArray(evt.references) ? evt.references : (evt.references ? [evt.references] : []),
          plusToken: plusToken || null,
          s3Bucket: evt.s3?.bucket || null,
          s3Key: evt.s3?.objectKey || null,
          receivedAt: new Date(),
          // Optionally link back
          campaignId: emailLog?.campaignId || null,
          leadId: emailLog?.leadId || null,
          emailLogId: emailLog?.id || null
        }
      });
    }

    // 7) Flip originating EmailLog to REPLIED
    if (emailLog) {
      console.log("Creating email log");
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: "REPLIED", repliedAt: new Date() }
      });
    }

    console.log("Done");

    return res.json({ ok: true, tenantId, conversationId: conversation.id, emailLogId: emailLog?.id || null });
}
