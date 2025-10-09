/**
 * Normalize email by converting to lowercase and validating.
 * @param {string} email - The email to normalize.
 * @returns {string|null} - The normalized email or null if invalid.
 */
export const normalizeEmail = (email) => {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  return emailRegex.test(normalized) ? normalized : null;
};

/**
 * Normalize phone number to E.164 format.
 * @param {string} phone - The phone number to normalize.
 * @returns {string|null} - The normalized phone number or null if invalid.
 */
export const normalizePhone = (phone) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : null;
};

/**
 * Canonicalize LinkedIn URL.
 * @param {string} url - The LinkedIn URL to canonicalize.
 * @returns {string|null} - The canonicalized URL or null if invalid.
 */
export const canonicalizeLinkedInUrl = (url) => {
  if (!url) return null;
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.includes("linkedin.com")) return null;
    return parsedUrl.origin + parsedUrl.pathname;
  } catch {
    return null;
  }
};

/**
 * Derive domain and normalized name from email and name.
 * @param {string} email - The email to extract the domain from.
 * @param {string} name - The name to normalize.
 * @returns {object|null} - An object with `domain` and `name` or null if invalid.
 */
export const deriveDomainPlusName = (email, name) => {
  if (!email || !name) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  const normalizedName = name.trim().toLowerCase();
  return domain && normalizedName ? { domain, name: normalizedName } : null;
};
