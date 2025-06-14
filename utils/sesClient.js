import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// Initialize SES client
const ses = new SESClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_SES_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SES_SECRET_KEY,
  },
});

// Send a basic HTML email
export const sendEmail = async ({ to, subject, html }) => {
  const params = {
    Source: "sales@productimate.io", // Replace with SES verified email
    Destination: {
      ToAddresses: [to],
    },
    Message: {
      Subject: {
        Data: subject,
      },
      Body: {
        Html: {
          Data: html,
        },
      },
    },
  };

  try {
    const command = new SendEmailCommand(params);
    const response = await ses.send(command);
    console.log("Email sent!", response.MessageId);
    return response;
  } catch (err) {
    console.error("Error sending email", err);
    throw err;
  }
};
