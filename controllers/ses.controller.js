import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import {
  verifyEmailIdentity,
  getIdentityVerificationAttributes,
  sendEmail as sesSendEmail,
  verifyDomainIdentity,
  enableDKIMSigning,
  initiateSubdomainIdentity,
  processInbound,
} from "../services/ses.service.js";
import { runPostInboundAutomation } from "../services/ai.service.js";

// POST /ses/onboard-domain
export async function onboardDomain(req, res, next) {
  try {
    const { domainName } = req.body;
    if (!domainName)
      return res.status(400).json({ error: "Domain name is required" });
    if (!req.user.tenantId)
      return res.status(400).json({ error: "Tenant details is required" });

    // 0. Prevent duplicates
    const existing = await prisma.domainIdentity.findFirst({
      where: { domainName },
    });
    if (existing) {
      return res.status(409).json({
        error: `Domain ${domainName} is already onboarded for an account.`,
      });
    }

    // SES: initiate domain verification
    const { records, token } = await verifyDomainIdentity(domainName);

    // Persist DomainIdentity record
    const domain = await prisma.domainIdentity.create({
      data: {
        tenantId: req.user.tenantId,
        domainName,
        verificationToken: token,
        verificationStatus: "Pending",
        dkimTokens: [],
        dkimRecords: records,
      },
    });

    const signing = await enableDKIMSigning(domainName);

    return res.json({
      message: "Domain onboarding initiated. Add these DNS records:",
      domain,
      dnsInstruction: records,
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
      return res
        .status(400)
        .json({ error: "domainId and emailAddress are required" });

    // Ensure domain exists & is verified
    const domain = await prisma.domainIdentity.findFirst({
      where: {
        id: domainId,
        tenantId: req.user.tenantId,
        verificationStatus: "Success",
      },
    });
    if (!domain)
      return res
        .status(400)
        .json({ error: "Domain not found or not verified" });

    //Check if this email already exists in DB
    const existing = await prisma.emailIdentity.findUnique({
      where: { emailAddress },
    });
    if (existing) {
      return res.status(200).json({
        message: `Email ${emailAddress} is already onboarded.`,
        email: existing,
      });
    }
    // SES: initiate email verification
    await verifyEmailIdentity(emailAddress); //This sends a verification email to the email address.User must click the link in that email to complete verification.

    // Persist EmailIdentity
    const email = await prisma.emailIdentity.create({
      data: {
        domainId,
        emailAddress,
        verificationStatus: "Pending",
      },
    });

    return res.json({
      message: `Email verification initiated for ${emailAddress}`,
      email,
    });
  } catch (err) {
    next(err);
  }
}

// POST /ses/verify-status
export async function checkVerificationStatus(req, res, next) {
  try {
    const { identity } = req.body;
    if (!identity)
      return res.status(400).json({ error: "Identity is required" });

    // SES: fetch verification attributes
    const attrs = await getIdentityVerificationAttributes([identity]);
    const rec = attrs[identity];
    if (!rec)
      return res.status(404).json({ error: `No SES record for ${identity}` });

    const status = rec.VerificationStatus;

    // Update DomainIdentity if matches
    await prisma.domainIdentity.updateMany({
      where: { tenantId: req.user.tenantId, domainName: identity },
      data: {
        verificationStatus: status,
        verifiedAt: status === "Success" ? new Date() : undefined,
        dkimTokens: rec.DkimAttributes
          ? Object.values(rec.DkimAttributes).map((d) => String(d))
          : undefined,
      },
    });

    // Update EmailIdentity if matches
    await prisma.emailIdentity.updateMany({
      where: {
        domain: { tenantId: req.user.tenantId },
        emailAddress: identity,
      },
      data: {
        verificationStatus: status,
        verifiedAt: status === "Success" ? new Date() : undefined,
      },
    });

    return res.json({
      identity,
      status,
      verificationToken: rec.VerificationToken,
    });
  } catch (err) {
    next(err);
  }
}

// GET /ses/identities
export async function listIdentities(req, res, next) {
  try {
    const domains = await prisma.domainIdentity.findMany({
      where: { tenantId: req.query.tenantId, deletedAt: null },
      include: {
        emailIdentities: {
          where: { deletedAt: null },
          select: {
            id: true,
            emailAddress: true,
            verificationStatus: true,
            verifiedAt: true,
          },
        },
      },
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
    const {
      fromEmail,
      toEmail,
      subject,
      htmlBody,
      configurationSetName,
      campaignId,
      leadId,
    } = req.body;

    if (
      !tenantId ||
      !fromEmail ||
      !toEmail ||
      !subject ||
      !htmlBody ||
      !campaignId ||
      !leadId
    ) {
      return res.status(400).json({
        error:
          "tenantId, fromEmail, toEmail, subject, htmlBody, campaignId, and leadId are required",
      });
    }

    // 1) Resolve inbound subdomain
    const inbound = await prisma.domainIdentity.findFirst({
      where: {
        tenantId,
        domainName: { startsWith: "inbound." },
        verificationStatus: "Success",
      },
      select: { domainName: true },
    });
    if (!inbound) {
      return res
        .status(400)
        .json({ error: "Inbound subdomain not verified for this tenant" });
    }

    // 2) Pre-create a conversation/thread key
    const tempToken = crypto.randomUUID(); // stable ID for reply-to
    const replyTo = `reply+${tempToken}@${inbound.domainName}`;

    // 3) Send via SES
    const result = await sesSendEmail({
      fromEmail,
      toEmail,
      subject,
      htmlBody,
      configurationSetName:
        configurationSetName || process.env.SES_CONFIGURATION_SET,
      replyToAddresses: [replyTo],
      messageTags: [
        { Name: "tenantId", Value: tenantId },
        { Name: "leadId", Value: leadId },
        { Name: "campaignId", Value: campaignId },
      ],
    });

    // 4) Persist atomically
    await prisma.$transaction(async (tx) => {
      // upsert conversation
      const conversation = await tx.conversation.upsert({
        where: { tenantId_threadKey: { tenantId, threadKey: tempToken } },
        create: {
          tenantId,
          threadKey: tempToken,
          subject,
          participants: [fromEmail, toEmail],
          lastMessageAt: new Date(),
        },
        update: {
          subject: { set: subject },
          participants: {
            set: Array.from(
              new Set([
                fromEmail,
                toEmail,
                ...((
                  await tx.conversation.findUnique({
                    where: {
                      tenantId_threadKey: { tenantId, threadKey: tempToken },
                    },
                    select: { participants: true },
                  })
                )?.participants ?? []),
              ])
            ),
          },
          lastMessageAt: new Date(),
        },
      });

      // create outbound email message
      const message = await tx.emailMessage.upsert({
        where: {
          tenantId_providerMessageId: {
            tenantId,
            providerMessageId: result.MessageId,
          },
        },
        create: {
          tenantId,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          provider: "AWS_SES",
          providerMessageId: result.MessageId,
          subject,
          from: [fromEmail],
          to: [toEmail],
          html: htmlBody,
          headers: { "Reply-To": replyTo },
          verdicts: {},
          plusToken: tempToken,
          sentAt: new Date(),
          campaignId,
          leadId,
        },
        update: {},
      });

      // create initial SENT event
      await tx.emailEvent.create({
        data: {
          tenantId,
          messageId: message.id,
          type: "SENT",
          providerMessageId: result.MessageId,
          createdAt: new Date(),
          metadata: {
            fromEmail,
            toEmail,
            configurationSetName,
          },
        },
      });
    });

    return res.json({
      message: "Email sent",
      messageId: result.MessageId,
      replyTo,
    });
  } catch (err) {
    console.error("sendTrackedEmail error:", err);
    next(err);
  }
}

// POST /ses/onboard-subdomain
export async function onboardSubdomain(req, res, next) {
  try {
    const { domainId, prefix = "inbound" } = req.body;
    const tenantId = req.user.tenantId;
    if (!domainId) {
      return res.status(400).json({ error: "domainId is required" });
    }

    // 1) Fetch parent domain and ensure it’s verified
    const parent = await prisma.domainIdentity.findFirst({
      where: { id: domainId, tenantId },
    });
    if (!parent || parent.verificationStatus !== "Success") {
      return res
        .status(400)
        .json({ error: "Base domain not found or not verified" });
    }

    // 2) Build subdomain string
    const subDomain = `${prefix}.${parent.domainName}`;

    // 3) Prevent duplicates
    const existing = await prisma.domainIdentity.findFirst({
      where: { tenantId, domainName: subDomain },
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: `Subdomain ${subDomain} is already onboarded` });
    }

    // 4) Call SES to generate DNS instructions
    const { records, token } = await initiateSubdomainIdentity(
      subDomain,
      prefix
    );

    // 5) Persist the new subdomain identity
    const record = await prisma.domainIdentity.create({
      data: {
        tenantId,
        domainName: subDomain,
        verificationToken: token,
        verificationStatus: "Pending",
        dkimRecords: records,
      },
    });

    // 6) Return instructions to front-end
    return res.json({
      message: "Subdomain onboarding initiated. Add these DNS records:",
      subdomain: record,
      dnsInstructions: records,
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
      return res
        .status(400)
        .json({ error: "identity query param is required" });

    // SES: fetch verification attributes
    const attrs = await getIdentityVerificationAttributes([identity]);
    const rec = attrs[identity];
    if (!rec)
      return res.status(404).json({ error: `No SES record for ${identity}` });

    const status = rec.VerificationStatus;

    // Update our DB
    await prisma.domainIdentity.updateMany({
      where: { tenantId: req.user.tenantId, domainName: identity },
      data: {
        verificationStatus: status,
        verifiedAt: status === "Success" ? new Date() : undefined,
      },
    });

    return res.json({ identity, status });
  } catch (err) {
    next(err);
  }
}

export async function inboundWebhook(req, res, next) {
  try {
    if (req.headers["x-internal-secret"] !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: "unauthorised" });
    }

    // ✅ Acknowledge fast to prevent client timeouts + retries
    res.status(202).end();

    // Do the heavy work off the response lifecycle
    setImmediate(async () => {
      try {
         const result = await processInbound(req.body); // now returns IDs
         if (result?.inboundMessageId && result?.conversationId && result?.tenantId) {
           try {
             await runPostInboundAutomation({
               tenantId: result.tenantId,
               conversationId: result.conversationId,
               inboundMessageId: result.inboundMessageId
             });
           } catch (aiErr) {
             console.error("post-inbound AI automation failed", aiErr);
           }
         }
      } catch (e) {
        console.error("processInbound failed", e);
      }
    });
  } catch (e) {
    // if we reached here, we couldn't even ack; log it
    console.error("inboundWebhook error", e);
    try {
      res.status(202).end();
    } catch {}
  }
}
