import axios from 'axios';

// read from env (default to the given base URL)
const BASE_URL = process.env.SPAM_SERVICE_URL
  || 'https://lead-generation-production-d101.up.railway.app';

/**
 * Sends the email body to the spam-score API and returns a 0–10 score.
 * @param {string} emailBody
 * @returns {Promise<number>}
 */
export async function getSpamScore(emailBody, incomingAuth) {
  const url = `${BASE_URL}/api/get_spam_score`;
  const payload = { email_body: emailBody };
  const resp = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json', Authorization: incomingAuth, },
    timeout: 5_000
  });
  console.log("Status", resp.status);

  // assuming the API returns { score: number } – adjust if it's just the number
  if (resp.status !== 200) {
    throw new Error(`Spam API responded ${resp.status}`);
  }
  // adapt this to resp.data if the shape differs
  return typeof resp.data === 'number'
    ? resp.data
    : resp.data.score;
}
