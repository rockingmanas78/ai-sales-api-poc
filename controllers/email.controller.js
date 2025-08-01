import { getSpamScore } from '../services/ai.service.js';
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

/**
 * POST /api/spam-score
 * { emailBody: string }
 */
export async function spamScoreController(req, res, next) {
  try {
    const { emailBody } = req.body;
    if (!emailBody || typeof emailBody !== 'string') {
      return res.status(400).json({ error: 'emailBody is required as a string' });
    }
        const incomingAuth = req.headers.authorization;
    if (!incomingAuth) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const score = await getSpamScore(emailBody, incomingAuth);
    res.json({ score });
  } catch (err) {
    next(err);
  }
}