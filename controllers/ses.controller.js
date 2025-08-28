import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { 
  verifyEmailIdentity, 
  getIdentityVerificationAttributes,
  sendEmail as sesSendEmail,
  verifyDomainIdentity,
  enableDKIMSigning,
  initiateSubdomainIdentity,
} from "../services/ses.service.js";

// POST /ses/onboard-domain
export async function onboardDomain(req, res, next) {
  try {
    const { domainName } = req.body;
    if (!domainName) return res.status(400).json({ error: 'Domain name is required' });
    if (!req.user.tenantId) return res.status(400).json({ error: 'Tenant details is required' });

        // 0. Prevent duplicates
    const existing = await prisma.domainIdentity.findFirst({
      where: { domainName }
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: `Domain ${domainName} is already onboarded for an account.` });
    }

    // SES: initiate domain verification
    const { records, token } = await verifyDomainIdentity(domainName);

    // Persist DomainIdentity record
    const domain = await prisma.domainIdentity.create({
      data: {
        tenantId:   req.user.tenantId,
        domainName,
        verificationToken: token,
        verificationStatus: 'Pending',
        dkimTokens: [],
        dkimRecords: records
      }
    });

    const signing = await enableDKIMSigning(domainName);

    return res.json({
      message: "Domain onboarding initiated. Add these DNS records:",
      domain,
      dnsInstruction: records
    });
  } catch (err) {
    console.log(err);
    next(err);
  }
}

// POST /ses/onboard-email
export async function onboardEmail(req, res, next) {
  try {
    const { domainId, emailAddress } = req.body;
    if (!domainId || !emailAddress)
      return res.status(400).json({ error: 'domainId and emailAddress are required' });

    // Ensure domain exists & is verified
    const domain = await prisma.domainIdentity.findFirst({
      where: { id: domainId,
        tenantId: req.user.tenantId,
        verificationStatus: 'Success' }
    });
    if (!domain)
      return res.status(400).json({ error: 'Domain not found or not verified' });

    //Check if this email already exists in DB
    const existing = await prisma.emailIdentity.findUnique({
      where: { emailAddress }
    });
    if (existing) {
      return res.status(200).json({
        message: `Email ${emailAddress} is already onboarded.`,
        email: existing
      });
    }
    // SES: initiate email verification
    await verifyEmailIdentity(emailAddress); //This sends a verification email to the email address.User must click the link in that email to complete verification.

    // Persist EmailIdentity
    const email = await prisma.emailIdentity.create({
      data: {
        domainId,
        emailAddress,
        verificationStatus: 'Pending'
      }
    });

    return res.json({
      message: `Email verification initiated for ${emailAddress}`,
      email
    });
  } catch (err) {
    next(err);
  }
}

// POST /ses/verify-status
export async function checkVerificationStatus(req, res, next) {
  try {
    const { identity } = req.body;
    if (!identity) return res.status(400).json({ error: 'Identity is required' });

    // SES: fetch verification attributes
    const attrs = await getIdentityVerificationAttributes([identity]);
    const rec   = attrs[identity];
    if (!rec) return res.status(404).json({ error: `No SES record for ${identity}` });

    const status = rec.VerificationStatus;

    // Update DomainIdentity if matches
    await prisma.domainIdentity.updateMany({
      where: { tenantId: req.user.tenantId, domainName: identity },
      data: {
        verificationStatus: status,
        verifiedAt: status === 'Success' ? new Date() : undefined,
        dkimTokens: rec.DkimAttributes
          ? Object.values(rec.DkimAttributes).map(d => String(d))
          : undefined
      }
    });

    // Update EmailIdentity if matches
    await prisma.emailIdentity.updateMany({
      where: { domain: { tenantId: req.user.tenantId }, emailAddress: identity },
      data: {
        verificationStatus: status,
        verifiedAt: status === 'Success' ? new Date() : undefined
      }
    });

    return res.json({
      identity,
      status,
      verificationToken: rec.VerificationToken
    });
  } catch (err) {
    next(err);
  }
};

// GET /ses/identities
export async function listIdentities(req, res, next) {
  try {
    const domains = await prisma.domainIdentity.findMany({
      where: { tenantId: req.query.tenantId, deletedAt: null },
      include: {
        emailIdentities: {
          where: { deletedAt: null },
          select: { id: true, emailAddress: true, verificationStatus: true, verifiedAt: true }
        }
      }
    });
    return res.json(domains);
  } catch (err) {
    next(err);
  }
}

// POST /ses/send-email
// export async function sendTrackedEmail(req, res, next) {
//   try {
//     const { fromEmail, toEmail, subject, htmlBody, configurationSetName } = req.body;
//     if (!toEmail || !subject || !htmlBody
//       // || !configurationSetName
//     )
//       return res.status(400).json({
//         error: 'toEmail, subject, htmlBody, and configurationSetName are required'
//       });

//     const result = await sesSendEmail({
//       fromEmail,
//       toEmail,
//       subject,
//       htmlBody,
//       configurationSetName
//     });
//     return res.json({ message: 'Email sent', messageId: result.MessageId });
//   } catch (err) {
//     next(err);
//   }
// }
// controllers/ses.controller.js
export async function sendTrackedEmail(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    const { fromEmail, toEmail, subject, htmlBody, configurationSetName } = req.body;

    if (!tenantId || !fromEmail || !toEmail || !subject || !htmlBody || !configurationSetName) {
      return res.status(400).json({
        error: "tenantId, fromEmail, toEmail, subject, htmlBody, configurationSetName are required"
      });
    }

    // 1) Pre-create the EmailLog to get a stable token (id)
    const emailLog = await prisma.emailLog.create({
      data: {
        tenantId,
        campaignId: null,
        leadId: null,
        status: "QUEUED",
        senderEmail: fromEmail,
        recipientEmails: [toEmail],
        subject,
        content: htmlBody,
        createdAt: new Date()
      }
    });

    // 2) Resolve tenant inbound subdomain
    const inbound = await prisma.domainIdentity.findFirst({
      where: { tenantId, domainName: { startsWith: "inbound." }, verificationStatus: "Success" },
      select: { domainName: true }
    });
    if (!inbound) {
      return res.status(400).json({ error: "Inbound subdomain not verified for this tenant" });
    }

    // 3) Build Reply-To using plus-addressing (RFC 5233)
    const replyTo = `reply+${emailLog.id}@${inbound.domainName}`;

    // 4) Send with configuration set, Reply-To, and tags
    const result = await sesSendEmail({
      fromEmail,
      toEmail,
      subject,
      htmlBody,
      configurationSetName,
      replyToAddresses: [replyTo],
      messageTags: [
        { Name: "tenantId", Value: tenantId },
        { Name: "emailLogId", Value: emailLog.id }
      ]
    });

    // 5) Persist SES ids and mark SENT
    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: result.MessageId,  // SES classic message id
        outboundMessageId: result.MessageId,
        replyToToken: emailLog.id
      }
    });

    return res.json({
      message: "Email sent",
      messageId: result.MessageId,
      emailLogId: emailLog.id,
      replyTo
    });
  } catch (err) {
    next(err);
  }
}


// POST /ses/onboard-subdomain
export async function onboardSubdomain(req, res, next) {
  try {
    const { domainId, prefix = 'inbound' } = req.body;
    const tenantId = req.user.tenantId;
    if (!domainId) {
      return res.status(400).json({ error: 'domainId is required' });
    }

    // 1) Fetch parent domain and ensure it’s verified
    const parent = await prisma.domainIdentity.findFirst({
      where: { id: domainId, tenantId }
    });
    if (!parent || parent.verificationStatus !== 'Success') {
      return res
        .status(400)
        .json({ error: 'Base domain not found or not verified' });
    }

    // 2) Build subdomain string
    const subDomain = `${prefix}.${parent.domainName}`;

    // 3) Prevent duplicates
    const existing = await prisma.domainIdentity.findFirst({
      where: { tenantId, domainName: subDomain }
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: `Subdomain ${subDomain} is already onboarded` });
    }

    // 4) Call SES to generate DNS instructions
    const { records, token } = await initiateSubdomainIdentity(subDomain, prefix);

    // 5) Persist the new subdomain identity
    const record = await prisma.domainIdentity.create({
      data: {
        tenantId,
        domainName:         subDomain,
        verificationToken:  token,
        verificationStatus: 'Pending',
        dkimRecords:        records
      }
    });

    // 6) Return instructions to front-end
    return res.json({
      message: 'Subdomain onboarding initiated. Add these DNS records:',
      subdomain:       record,
      dnsInstructions: records
    });
  } catch (err) {
    next(err);
  }
}


// GET /ses/subdomain-status?identity=inbound.example.com
export async function checkSubdomainStatus(req, res, next) {
  try {
    const { identity } = req.query;
    if (!identity) 
      return res.status(400).json({ error: 'identity query param is required' });

    // SES: fetch verification attributes
    const attrs = await getIdentityVerificationAttributes([identity]);
    const rec   = attrs[identity];
    if (!rec) 
      return res.status(404).json({ error: `No SES record for ${identity}` });

    const status = rec.VerificationStatus;

    // Update our DB
    await prisma.domainIdentity.updateMany({
      where: { tenantId: req.user.tenantId, domainName: identity },
      data: {
        verificationStatus: status,
        verifiedAt: status === 'Success' ? new Date() : undefined
      }
    });

    return res.json({ identity, status });
  } catch (err) {
    next(err);
  }
}

// export async function inboundWebhook(req, res, next) {
//   try {
//     if (req.headers['x-internal-secret'] !== process.env.WEBHOOK_SECRET)
//       return res.status(401).json({ error: 'unauthorised' });

//     console.log(req.body);

//     //await processInbound(req.body);
//     res.json({ status: 'ok' });
//   } catch (e) { next(e); }
// }
// controllers/ses.controller.js
export async function inboundWebhook(req, res, next) {
  try {
    if (req.headers["x-internal-secret"] !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: "unauthorised" });
    }

    const evt = req.body;

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
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: "REPLIED", repliedAt: new Date() }
      });
    }

    console.log("Done");

    return res.json({ ok: true, tenantId, conversationId: conversation.id, emailLogId: emailLog?.id || null });
  } catch (e) { next(e); }
}



/*
[{"ttl": 1800, "Name": "pfos6uc2xytbd42q3k35hcb5npmnfkp5._domainkey.productimate.io", "type": "CNAME", "value": "pfos6uc2xytbd42q3k35hcb5npmnfkp5.dkim.amazonses.com"}, {"ttl": 1800, "Name": "nfbn7mbrelfttbf4ngcaaphsmbqxernd._domainkey.productimate.io", "type": "CNAME", "value": "nfbn7mbrelfttbf4ngcaaphsmbqxernd.dkim.amazonses.com"}, {"ttl": 1800, "Name": "yh7bp6xueooucz5uvo2txjal7wy6up4k._domainkey.productimate.io", "type": "CNAME", "value": "yh7bp6xueooucz5uvo2txjal7wy6up4k.dkim.amazonses.com"}, {"ttl": 1800, "Name": "_dmarc.productimate.io", "type": "TXT", "value": "v=DMARC1; p=none;"}, {"ttl": 1800, "name": "productimate.io", "type": "TXT", "value": "v=spf1 include:amazonses.com ~all"}, {"ttl": 1800, "name": "_amazonses.productimate.io", "type": "TXT", "value": "Z6qwpwuf8d/KxsQW38cvPXCLumCYcRC1gpFmYQrfumE="}]
*/