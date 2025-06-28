import {
    SESClient,
    VerifyDomainIdentityCommand,
    VerifyEmailIdentityCommand,
    GetIdentityVerificationAttributesCommand,
    SendEmailCommand,
} from '@aws-sdk/client-ses';

const ses = new SESClient({
    region: process.env.AWS_SES_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SES_SECRET_KEY,
    },
});

export async function verifyDomainIdentity(domainName) {
  const cmd = new VerifyDomainIdentityCommand({ Domain: domainName });
  const res = await ses.send(cmd);
  return res.VerificationToken;
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
    ConfigurationSetName: configurationSetName
  });
  return await ses.send(cmd);
}

// export async function verifyDomainIndetity(domainName) {
//     const cmd = new VerifyDomainIdentityCommand({Domian: domainName});
//     const res = await ses.send(cmd);
//     return res.VerificationToken;
// }

// export async function verifyEmailIdentity(emailAddress) {
//   const cmd = new VerifyEmailIdentityCommand({ EmailAddress: emailAddress });
//   const res = await ses.send(cmd);
//   return res;
// }

// export async function getIdentityVerificationAttributes(identities) {
//   const cmd = new GetIdentityVerificationAttributesCommand({ Identities: identities });
//   const res = await ses.send(cmd);
//   return res.VerificationAttributes;
// }

// export async function sendEmail({toEmail, subject, htmlBody, configurationSetName}){
//     const cmd = new SendEmailCommand({
//         Destination: {ToAddresses: [toEmail]},
//         Message: {
//             Subject: {Charset: "UTF-8" , Data: subject},
//             Body: {Html: {Charset: "UTF-8" , Data: htmlBody}},
//         },
//         Source: process.env.SES_SOURCE_EMAIL,
//         ConfigurationSetName: configurationSetName,
//     });
//     const res = await ses.send(cmd);
//     return res;
// }