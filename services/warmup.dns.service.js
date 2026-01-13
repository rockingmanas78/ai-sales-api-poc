// services/warmup.dns.service.js

import { SESClient, VerifyDomainDkimCommand, VerifyDomainIdentityCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_SES_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_PROD_ACCESS_KEY,
    secretAccessKey: process.env.AWS_PROD_SECRET_KEY,
  },
});

/**
 * Generates all records needed to verify a warmup subdomain in SES
 * @param {string} subdomain - e.g., "warmup.client.com"
 * @param {string} verificationToken - The SES Verification Token
 * @param {string[]} dkimTokens - The 3 tokens returned by SES DKIM initiation
 */
export function getWarmupDnsInstructions(subdomain, verificationToken, dkimTokens = []) {
  const region = process.env.AWS_REGION || "ap-south-1";
  const inboundEndpoint = `inbound-smtp.${region}.amazonaws.com`;
  
  const records = [];

  // 1. SES Domain Verification (TXT)
  records.push({
    type: "TXT",
    host: `_amazonses.${subdomain}`,
    value: verificationToken,
    description: "Required for AWS SES to verify ownership of the subdomain."
  });

  // 2. DKIM Records (CNAMEs) - THE MISSING PIECE FOR VERIFICATION
  dkimTokens.forEach(token => {
    records.push({
      type: "CNAME",
      host: `${token}._domainkey.${subdomain}`,
      value: `${token}.dkim.amazonses.com`,
      description: "Required for SES to verify and sign outgoing warmup emails."
    });
  });

  // 3. MX Record (For Receiving)
  records.push({
    type: "MX",
    host: subdomain,
    value: `10 ${inboundEndpoint}`,
    description: "Directs replies to SES so your warmup bot can process them."
  });

  // 4. SPF Record (Authorizing SES)
  records.push({
    type: "TXT",
    host: subdomain,
    value: "v=spf1 include:amazonses.com ~all",
    description: "Prevents warmup emails from being flagged as unauthorized."
  });

  // 5. DMARC Record (Security)
  records.push({
    type: "TXT",
    host: `_dmarc.${subdomain}`,
    value: "v=DMARC1; p=none;",
    description: "Tells receiving servers how to handle mail that fails SPF/DKIM."
  });

  return records;
}

export async function registerWarmupSubdomainInSes(subdomain) {
  // 1. Verify the Identity (Get Verification Token)
  const verifyCmd = new VerifyDomainIdentityCommand({ Domain: subdomain });
  const verifyRes = await ses.send(verifyCmd);
  const verificationToken = verifyRes.VerificationToken;

  // 2. Initiate DKIM (Get DKIM Tokens)
  const dkimCmd = new VerifyDomainDkimCommand({ Domain: subdomain });
  const dkimRes = await ses.send(dkimCmd);
  const dkimTokens = dkimRes.DkimTokens || [];

  // 3. Generate the full Instruction List
  const dnsRecords = getWarmupDnsInstructions(subdomain, verificationToken, dkimTokens);

  return {
    verificationToken,
    dkimTokens,
    dnsRecords
  };
}