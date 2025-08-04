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

export async function sendEmail({
  fromEmail,
  toEmail,
  subject,
  htmlBody,
  configurationSetName
}) {
  const cmd = new SendEmailCommand({
    Source: fromEmail,                       // ← now dynamic
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body:    { Html:   { Data: htmlBody, Charset: "UTF-8" } }
    },
    ...(configurationSetName && { ConfigurationSetName: configurationSetName })
  });

  let res = await ses.send(cmd);
  return res;
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
  const domain = evt.destinations?.[0]?.split('@')[1];   // inbound.tenant.com
  const tenant = await prisma.domainIdentity.findFirst({
    where: { domainName: domain, verificationStatus: 'Success' },
    select: { tenantId: true }
  });

  // await prisma.inboundEmail.create({
  //   data: {
  //     tenantId: tenant?.tenantId ?? null,
  //     messageId: evt.messageId,
  //     from: evt.from,
  //     to:   evt.to?.join(','),
  //     subject: evt.subject,
  //     receivedAt: new Date(evt.timestamp)
  //   }
  // });
}
