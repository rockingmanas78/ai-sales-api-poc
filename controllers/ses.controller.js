// controllers/sesDomainController.js
import { SESClient, VerifyDomainIdentityCommand,VerifyEmailIdentityCommand,GetIdentityVerificationAttributesCommand, } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: "ap-south-1" }); // change to your SES region

export const onboardDomain = async (req, res) => {
  const { domainName } = req.body;

  if (!domainName) {
    return res.status(400).json({ error: "Domain name is required" });
  }

  try {
    const command = new VerifyDomainIdentityCommand({ Domain: domainName });
    const response = await ses.send(command);

    // This is the verification token you need to add as a TXT DNS record
    const token = response.VerificationToken;

    res.status(200).json({
      message: "Verification initiated",
      domain: domainName,
      dnsInstructions: {
        type: "TXT",
        name: `_amazonses.${domainName}`,
        value: token,
        ttl: 1800,
      },
    });
  } catch (error) {
    console.error("Error verifying domain:", error);
    res.status(500).json({ error: "Failed to initiate domain verification" });
  }
};


export const onboardEmail = async (req, res) => {
  const { emailAddress } = req.body;

  if (!emailAddress) {
    return res.status(400).json({ error: "Email address is required" });
  }

  try {
    const command = new VerifyEmailIdentityCommand({ EmailAddress: emailAddress });
    await ses.send(command);

    res.status(200).json({
      message: `Verification email sent to ${emailAddress}. Please confirm from inbox.`,
    });
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({ error: "Failed to initiate email verification" });
  }
};

export const checkVerificationStatus = async (req, res) => {
  const { identity } = req.body;

  if (!identity) {
    return res.status(400).json({ error: "Email or domain identity is required" });
  }

  try {
    const command = new GetIdentityVerificationAttributesCommand({
      Identities: [identity],
    });

    const { VerificationAttributes } = await ses.send(command);

    const status = VerificationAttributes[identity]?.VerificationStatus;

    if (!status) {
      return res.status(404).json({
        message: `No verification record found for ${identity}`,
      });
    }

    const response = {
      identity,
      verificationStatus: status, // 'Pending', 'Success', 'Failed'
    };

    // For domains, include the token too
    if (VerificationAttributes[identity]?.VerificationToken) {
      response.verificationToken = VerificationAttributes[identity].VerificationToken;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error checking verification status:", error);
    res.status(500).json({ error: "Failed to fetch verification status" });
  }
};