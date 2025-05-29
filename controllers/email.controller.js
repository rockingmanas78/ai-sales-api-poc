import * as emailService from '../services/email.service.js';

export async function createEmail(req, res, next) {
  try {
    const { to, from, subject, body } = req.body;
    const email = await emailService.queueEmail({ to, from, subject, body });
    res.status(201).json(email);
  } catch (err) {
    next(err);
  }
}

export async function getEmails(req, res, next) {
  try {
    const emails = await emailService.listEmails();
    res.json(emails);
  } catch (err) {
    next(err);
  }
}