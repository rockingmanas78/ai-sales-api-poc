import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();


const SUBJECT_TEMPLATES = [
  "Quick question",
  "Checking in",
  "Following up",
  "Thoughts?",
  "Re: Note",
  "Small update",
  "Hey",
  "Re: quick ping",
];

const BODY_TEMPLATES = [
  ({ sender, recipient }) =>
    `<p>Hey there — just testing deliverability from <b>${sender}</b> to <b>${recipient}</b>. Hope you're doing well.</p>`,
  () =>
    `<p>Just a quick note. If you see this, all good on my side.</p>`,
  () =>
    `<p>Hi! Sharing a tiny update. No action needed.</p>`,
  () =>
    `<p>Hey — quick check-in. Hope your day is going well.</p>`,
];

export function pickWarmupSubject(randomIndex) {
  return SUBJECT_TEMPLATES[randomIndex % SUBJECT_TEMPLATES.length];
}

export function pickWarmupHtmlBody({ randomIndex, senderEmail, recipientEmail }) {
  const templateFunction = BODY_TEMPLATES[randomIndex % BODY_TEMPLATES.length];
  return templateFunction({ sender: senderEmail, recipient: recipientEmail });
}
