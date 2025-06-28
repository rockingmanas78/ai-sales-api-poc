import { 
  verifyDomainIndetity, 
  verifyEmailIdentity, 
  getIdentityVerificationAttributes,
  sendEmail,
} from "../services/ses.service.js";

export async function onboardDomain(req, res, next) {
  const {domainName} = req.body;
  if(!domainName) return res.status(400).json({ error: "Domain name is required" });
  try {
    const token = await verifyDomainIndetity(domainName);
    res.json({
      message: "Verification initiated",
      domain: domainName,
      dnsInstruction: {
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
}

export async function onboardEmail(req, res, next) {
  const { emailAddress } = req.body;
  if (!emailAddress) return res.status(400).json({ error: "Email address is required" });
  try {
    await verifyEmailIdentity(emailAddress);
    res.json({ message: `Verification email sent to ${emailAddress}` });
  } catch (error) {
    console.error("Error verifying email:", error);
     res.status(500).json({ error: "Failed to initiate email verification" });
   }
}

export async function checkVerificationStatus(req, res, next) {
  const { identity } = req.body;
  if (!identity) return res.status(400).json({ error: "Identity is required" });
  try {
    const attrs = await getIdentityVerificationAttributes([identity]);
    const record = attrs[identity];
    if (!record) return res.status(404).json({ message: `No record for ${identity}` });
    const response = { identity, verificationStatus: record.VerificationStatus };
    if (record.VerificationToken) response.verificationToken = record.VerificationToken;
    res.json(response);
  } catch (error) {
     console.error("Error checking verification status:", error);
     res.status(500).json({ error: "Failed to fetch verification status" });
   }
}

export async function sendTrackedEmail(req, res, next) {
  const { toEmail, subject, htmlBody, configurationSetName } = req.body;
  if (!toEmail || !subject || !htmlBody || !configurationSetName) {
    return res.status(400).json({
      error: "toEmail, subject, htmlBody, and configurationSetName are required",
    });
  }
  try {
    const result = await sendEmail({ toEmail, subject, htmlBody, configurationSetName });
    res.json({ message: "Email sent", messageId: result.MessageId });
  } catch (error) {
     console.error("Error sending email:", error);
     res.status(500).json({ error: "Failed to send email" });
   }
}

// import {
//   SESClient,
//   VerifyDomainIdentityCommand,
//   VerifyEmailIdentityCommand,
//   GetIdentityVerificationAttributesCommand,
//   SendEmailCommand,
// } from "@aws-sdk/client-ses";


// const ses = new SESClient({
//   region: "ap-south-1",
//   credentials: {
//     accessKeyId: process.env.AWS_SES_ACCESS_KEY,
//     secretAccessKey: process.env.AWS_SES_SECRET_KEY,
//   },
// }); // Update to your SES region

// export const onboardDomain = async (req, res) => {
//   const { domainName } = req.body;

//   if (!domainName) {
//     return res.status(400).json({ error: "Domain name is required" });
//   }

//   try {
//     const command = new VerifyDomainIdentityCommand({ Domain: domainName });
//     const response = await ses.send(command);

//     const token = response.VerificationToken;

//     res.status(200).json({
//       message: "Verification initiated",
//       domain: domainName,
//       dnsInstructions: {
//         type: "TXT",
//         name: `_amazonses.${domainName}`,
//         value: token,
//         ttl: 1800,
//       },
//     });
//   } catch (error) {
//     console.error("Error verifying domain:", error);
//     res.status(500).json({ error: "Failed to initiate domain verification" });
//   }
// };

// export const onboardEmail = async (req, res) => {
//   const { emailAddress } = req.body;

//   if (!emailAddress) {
//     return res.status(400).json({ error: "Email address is required" });
//   }

//   try {
//     const command = new VerifyEmailIdentityCommand({ EmailAddress: emailAddress });
//     await ses.send(command);

//     res.status(200).json({
//       message: `Verification email sent to ${emailAddress}. Please confirm from inbox.`,
//     });
//   } catch (error) {
//     console.error("Error verifying email:", error);
//     res.status(500).json({ error: "Failed to initiate email verification" });
//   }
// };

// export const checkVerificationStatus = async (req, res) => {
//   const { identity } = req.body;

//   if (!identity) {
//     return res.status(400).json({ error: "Email or domain identity is required" });
//   }

//   try {
//     const command = new GetIdentityVerificationAttributesCommand({
//       Identities: [identity],
//     });

//     const { VerificationAttributes } = await ses.send(command);

//     const status = VerificationAttributes[identity]?.VerificationStatus;

//     if (!status) {
//       return res.status(404).json({
//         message: `No verification record found for ${identity}`,
//       });
//     }

//     const response = {
//       identity,
//       verificationStatus: status,
//     };

//     if (VerificationAttributes[identity]?.VerificationToken) {
//       response.verificationToken = VerificationAttributes[identity].VerificationToken;
//     }

//     res.status(200).json(response);
//   } catch (error) {
//     console.error("Error checking verification status:", error);
//     res.status(500).json({ error: "Failed to fetch verification status" });
//   }
// };

// export const sendTrackedEmail = async (req, res) => {
//   const { toEmail, subject, htmlBody, configurationSetName } = req.body;

//   if (!toEmail || !subject || !htmlBody || !configurationSetName) {
//     return res.status(400).json({
//       error: "toEmail, subject, htmlBody, and configurationSetName are required",
//     });
//   }

//   try {
//     const command = new SendEmailCommand({
//       Destination: {
//         ToAddresses: [toEmail],
//       },
//       Message: {
//         Subject: {
//           Charset: "UTF-8",
//           Data: subject,
//         },
//         Body: {
//           Html: {
//             Charset: "UTF-8",
//             Data: htmlBody,
//           },
//         },
//       },
//       Source: "sales@productimate.io", // Replace with your verified sender
//       ConfigurationSetName: configurationSetName,
//     });

//     const result = await ses.send(command);
//     res.status(200).json({
//       message: "Email sent successfully",
//       messageId: result.MessageId,
//     });
//   } catch (error) {
//     console.error("Error sending email:", error);
//     res.status(500).json({ error: "Failed to send email" });
//   }
// };
