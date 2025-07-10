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
    Name: `${token}._domainkey.${domainName}`,
    type: "CNAME",
    value: `${token}.dkim.amazonses.com`,
    ttl: 1800
  }));

  cnameRecords.push({
    Name: `_dmarc.${domainName}`,
    type: "TXT",
    value: "v=DMARC1; p=none;",
    ttl: 1800
  })

  cnameRecords.push({
      name: domainName,
      type: "TXT",
      value: "v=spf1 include:amazonses.com ~all",
      ttl: 1800,
    });

  cnameRecords.push({
    type: 'TXT',
    name: `_amazonses.${domainName}`,
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

export async function sendEmail({ toEmail, subject, htmlBody, configurationSetName }) {
  const cmd = new SendEmailCommand({
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body:    { Html: { Data: htmlBody, Charset: 'UTF-8' } }
    },
    Source: process.env.SES_SOURCE_EMAIL,
    //ConfigurationSetName: configurationSetName
  });
  return await ses.send(cmd);
}
