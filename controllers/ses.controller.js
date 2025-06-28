import { 
  verifyEmailIdentity, 
  getIdentityVerificationAttributes,
  sendEmail as sesSendEmail,
  verifyDomainIdentity,
} from "../services/ses.service.js";

// POST /ses/onboard-domain
export async function onboardDomain(req, res, next) {
  try {
    const { domainName } = req.body;
    if (!domainName) return res.status(400).json({ error: 'Domain name is required' });

    // SES: initiate domain verification
    const token = await verifyDomainIdentity(domainName);

    // Persist DomainIdentity record
    const domain = await prisma.domainIdentity.create({
      data: {
        tenantId:   req.user.tenantId,
        domainName,
        verificationToken: token,
        verificationStatus: 'Pending',
        dkimTokens: []
      }
    });

    return res.json({
      message: 'Domain verification initiated',
      domain,
      dnsInstruction: {
        type: 'TXT',
        name: `_amazonses.${domainName}`,
        value: token,
        ttl:   1800
      }
    });
  } catch (err) {
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
      where: { id: domainId, tenantId: req.user.tenantId, verificationStatus: 'Success' }
    });
    if (!domain)
      return res.status(400).json({ error: 'Domain not found or not verified' });

    // SES: initiate email verification
    await verifyEmailIdentity(emailAddress);

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
}

// GET /ses/identities
export async function listIdentities(req, res, next) {
  try {
    const domains = await prisma.domainIdentity.findMany({
      where: { tenantId: req.user.tenantId, deletedAt: null },
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
export async function sendTrackedEmail(req, res, next) {
  try {
    const { toEmail, subject, htmlBody, configurationSetName } = req.body;
    if (!toEmail || !subject || !htmlBody || !configurationSetName)
      return res.status(400).json({
        error: 'toEmail, subject, htmlBody, and configurationSetName are required'
      });

    const result = await sesSendEmail({
      toEmail,
      subject,
      htmlBody,
      configurationSetName
    });
    return res.json({ message: 'Email sent', messageId: result.MessageId });
  } catch (err) {
    next(err);
  }
}

// export async function onboardDomain(req, res, next) {
//   const {domainName} = req.body;
//   if(!domainName) return res.status(400).json({ error: "Domain name is required" });
//   try {
//     const token = await verifyDomainIndetity(domainName);
//     res.json({
//       message: "Verification initiated",
//       domain: domainName,
//       dnsInstruction: {
//         type: "TXT",
//         name: `_amazonses.${domainName}`,
//         value: token,
//         ttl: 1800,
//       },
//     });
//   } catch (error) {
//      console.error("Error verifying domain:", error);
//      res.status(500).json({ error: "Failed to initiate domain verification" });
//   }
// }

// export async function onboardEmail(req, res, next) {
//   const { emailAddress } = req.body;
//   if (!emailAddress) return res.status(400).json({ error: "Email address is required" });
//   try {
//     await verifyEmailIdentity(emailAddress);
//     res.json({ message: `Verification email sent to ${emailAddress}` });
//   } catch (error) {
//     console.error("Error verifying email:", error);
//      res.status(500).json({ error: "Failed to initiate email verification" });
//    }
// }

// export async function checkVerificationStatus(req, res, next) {
//   const { identity } = req.body;
//   if (!identity) return res.status(400).json({ error: "Identity is required" });
//   try {
//     const attrs = await getIdentityVerificationAttributes([identity]);
//     const record = attrs[identity];
//     if (!record) return res.status(404).json({ message: `No record for ${identity}` });
//     const response = { identity, verificationStatus: record.VerificationStatus };
//     if (record.VerificationToken) response.verificationToken = record.VerificationToken;
//     res.json(response);
//   } catch (error) {
//      console.error("Error checking verification status:", error);
//      res.status(500).json({ error: "Failed to fetch verification status" });
//    }
// }

// export async function sendTrackedEmail(req, res, next) {
//   const { toEmail, subject, htmlBody, configurationSetName } = req.body;
//   if (!toEmail || !subject || !htmlBody || !configurationSetName) {
//     return res.status(400).json({
//       error: "toEmail, subject, htmlBody, and configurationSetName are required",
//     });
//   }
//   try {
//     const result = await sendEmail({ toEmail, subject, htmlBody, configurationSetName });
//     res.json({ message: "Email sent", messageId: result.MessageId });
//   } catch (error) {
//      console.error("Error sending email:", error);
//      res.status(500).json({ error: "Failed to send email" });
//    }
// }
