import crypto from "crypto";

/**
 * Returns start of current UTC day (date-only semantics)
 */
export function getStartOfTodayUtcDateOnly() {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );
}

/**
 * Fully normalize email (local + domain)
 */
export function safeLowercaseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * UUID used as warmup thread unique key
 */
export function generateWarmupThreadKey() {
  return crypto.randomUUID();
}

/**
 * Token format:
 *   wm.<tenantId>.<uuid>
 */
export function buildWarmupToken({ tenantId, warmupUuid }) {
  return `wm.${tenantId}.${warmupUuid}`;
}

/**
 * Parse warmup token
 */
export function parseWarmupToken(token) {
  const raw = String(token || "").trim();
  if (!raw.startsWith("wm.")) return null;

  const parts = raw.split(".");
  if (parts.length < 3) return null;

  const tenantId = parts[1];
  const warmupUuid = parts.slice(2).join(".");

  if (!tenantId || !warmupUuid) return null;
  return { tenantId, warmupUuid };
}

/**
 * Build reply-to address routed to warmup reply domain
 */
export function buildWarmupReplyToAddress({ warmupToken, replyDomain }) {
  const domain = String(replyDomain || "").trim().toLowerCase();
  return `wreply+${warmupToken}@${domain}`;
}

/**
 * Extract +token from email addresses
 */
export function extractPlusTokenFromEmails(input) {
  const emails = Array.isArray(input)
    ? input
    : input
    ? [input]
    : [];

  for (const address of emails) {
    const local = String(address || "").split("@")[0];
    const plusIndex = local.indexOf("+");
    if (plusIndex > -1) {
      return local.slice(plusIndex + 1);
    }
  }
  return null;
}
