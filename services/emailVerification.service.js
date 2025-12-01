// src/services/emailVerification.service.js
import dns from "dns";
import net from "net";
import { promisify } from "util";

const resolveMx = promisify(dns.resolveMx);

// --- Env-driven config (with safe defaults) ---

const EMAIL_VERIFICATION_FROM =
  process.env.EMAIL_VERIFICATION_FROM || "verify@example.com";

const EMAIL_VERIFICATION_HELO_DOMAIN =
  process.env.EMAIL_VERIFICATION_HELO_DOMAIN || "example.com";

const EMAIL_VERIFICATION_TIMEOUT_MS = Number(
  process.env.EMAIL_VERIFICATION_TIMEOUT_MS || "8000"
);

const EMAIL_VERIFICATION_MAX_MX = Number(
  process.env.EMAIL_VERIFICATION_MAX_MX || "2"
);

// --- Catch-all detection cache + config ---

const domainCatchAllCache = new Map(); // domain -> { isCatchAll, checkedAt }
const CATCH_ALL_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache
const CATCH_ALL_PROBES = 3; // how many random addresses we probe for catch-all

// --- Disposable domains list (extensible later) ---

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "yopmail.com",
]);

// Basic but solid syntax check
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/**
 * Step 1: Syntax validation
 */
function checkSyntax(email) {
  if (!email || typeof email !== "string") {
    return { ok: false, reason: "Empty or non-string email" };
  }
  const trimmed = email.trim();
  if (!EMAIL_REGEX.test(trimmed)) {
    return { ok: false, reason: "Invalid email syntax" };
  }
  return { ok: true, email: trimmed };
}

/**
 * Step 2: Disposable / obvious bad domains
 */
function checkDisposable(email) {
  const [, domain] = email.split("@");
  if (!domain) return { disposable: false };

  const lowerDomain = domain.toLowerCase();

  if (DISPOSABLE_DOMAINS.has(lowerDomain)) {
    return { disposable: true, reason: "Disposable / throwaway domain" };
  }

  return { disposable: false };
}

/**
 * Step 3: MX lookup
 */
async function checkMxRecords(domain) {
  try {
    const records = await resolveMx(domain);
    if (!records || records.length === 0) {
      return { ok: false, reason: "No MX records for domain" };
    }
    // Sort by priority (lowest first)
    const sorted = records.sort(
      (a, b) => (a.priority || 0) - (b.priority || 0)
    );
    return { ok: true, hosts: sorted.map((r) => r.exchange) };
  } catch (err) {
    return {
      ok: false,
      reason: `DNS MX lookup failed: ${err.code || err.message}`,
    };
  }
}

/**
 * Step 4: SMTP RCPT TO probe (without sending)
 *
 * State-machine style, using:
 * - MAIL FROM: param `from` (defaults to EMAIL_VERIFICATION_FROM)
 * - HELO: EMAIL_VERIFICATION_HELO_DOMAIN
 */
function smtpProbe({
  host,
  from = EMAIL_VERIFICATION_FROM,
  to,
  timeoutMs = EMAIL_VERIFICATION_TIMEOUT_MS,
}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, host);
    let buffer = "";
    let step = "greeting"; // greeting -> helo -> mailFrom -> rcptTo
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        socket.end();
      } catch (_) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => {
      finish({ status: "UNKNOWN", reason: "SMTP timeout" });
    });

    socket.on("error", (err) => {
      finish({
        status: "UNKNOWN",
        reason: `SMTP connection error: ${err.code || err.message}`,
      });
    });

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";

      const match = lastLine.match(/^(\d{3})\s/);
      const code = match ? parseInt(match[1], 10) : null;
      if (!code) {
        return;
      }

      const is2xx = code >= 200 && code < 300;
      const is4xx = code >= 400 && code < 500;
      const is5xx = code >= 500 && code < 600;

      if (step === "greeting" && is2xx) {
        socket.write(`HELO ${EMAIL_VERIFICATION_HELO_DOMAIN}\r\n`);
        step = "helo";
        return;
      }

      if (step === "helo") {
        if (is2xx) {
          socket.write(`MAIL FROM:<${from}>\r\n`);
          step = "mailFrom";
          return;
        }
        if (is4xx) {
          finish({
            status: "UNKNOWN",
            reason: `SMTP soft failure after HELO: ${lastLine}`,
          });
          return;
        }
        if (is5xx) {
          finish({
            status: "UNKNOWN",
            reason: `SMTP hard failure after HELO: ${lastLine}`,
          });
          return;
        }
      }

      if (step === "mailFrom") {
        if (is2xx) {
          socket.write(`RCPT TO:<${to}>\r\n`);
          step = "rcptTo";
          return;
        }
        if (is4xx) {
          finish({
            status: "UNKNOWN",
            reason: `SMTP soft failure after MAIL FROM: ${lastLine}`,
          });
          return;
        }
        if (is5xx) {
          finish({
            status: "UNKNOWN",
            reason: `SMTP hard failure after MAIL FROM: ${lastLine}`,
          });
          return;
        }
      }

      if (step === "rcptTo") {
        if (is2xx) {
          socket.write("QUIT\r\n");
          finish({ status: "DELIVERABLE", reason: "RCPT TO accepted" });
          return;
        }

        if (is5xx) {
          socket.write("QUIT\r\n");
          finish({
            status: "UNDELIVERABLE",
            reason: `SMTP hard failure on RCPT TO: ${lastLine}`,
          });
          return;
        }

        if (is4xx) {
          socket.write("QUIT\r\n");
          finish({
            status: "UNKNOWN",
            reason: `SMTP soft failure on RCPT TO: ${lastLine}`,
          });
          return;
        }
      }
    });
  });
}

/**
 * Detect whether a domain behaves like a catch-all:
 * - If target email is not DELIVERABLE -> not catch-all
 * - If target email is DELIVERABLE:
 *   - Probe a few random mailboxes on same domain
 *   - If most/all random ones are DELIVERABLE => catch-all
 */
async function detectCatchAllForDomain(mxHost, domain, targetEmail, timeoutMs) {
  const now = Date.now();
  const cached = domainCatchAllCache.get(domain);
  if (cached && now - cached.checkedAt < CATCH_ALL_TTL_MS) {
    return {
      isCatchAll: cached.isCatchAll,
      targetResult: cached.targetResult,
    };
  }

  // 1) Try the actual target email
  const targetResult = await smtpProbe({
    host: mxHost,
    from: EMAIL_VERIFICATION_FROM,
    to: targetEmail,
    timeoutMs,
  });

  if (targetResult.status !== "DELIVERABLE") {
    domainCatchAllCache.set(domain, {
      isCatchAll: false,
      checkedAt: now,
      targetResult,
    });
    return { isCatchAll: false, targetResult };
  }

  // 2) Probe random addresses on the same domain
  let deliverableCount = 0;
  for (let i = 0; i < CATCH_ALL_PROBES; i++) {
    const randomLocal = `catchall_test_${Date.now()}_${Math.floor(
      Math.random() * 1_000_000
    )}`;
    const randomEmail = `${randomLocal}@${domain}`;

    const r = await smtpProbe({
      host: mxHost,
      from: EMAIL_VERIFICATION_FROM,
      to: randomEmail,
      timeoutMs,
    });

    if (r.status === "DELIVERABLE") {
      deliverableCount++;
    }
  }

  const isCatchAll = deliverableCount >= 2;

  domainCatchAllCache.set(domain, {
    isCatchAll,
    checkedAt: now,
    targetResult,
  });

  return { isCatchAll, targetResult };
}

/**
 * Verify a *single* email address.
 *
 * Returns:
 * {
 *   email,
 *   status: "DELIVERABLE" | "UNDELIVERABLE" | "UNKNOWN" | "INVALID_SYNTAX" | "DISPOSABLE",
 *   reason?: string,
 *   mxDomain?: string,
 *   subStatus?: "CATCH_ALL" | "NORMAL" | "UNKNOWN",
 *   riskLevel?: "LOW" | "MEDIUM" | "HIGH",
 *   checkedAt: ISO date string
 * }
 */
export async function verifySingleEmail(email) {
  const nowIso = new Date().toISOString();

  // 1) Syntax
  const syntax = checkSyntax(email);
  if (!syntax.ok) {
    return {
      email,
      status: "INVALID_SYNTAX",
      reason: syntax.reason,
      checkedAt: nowIso,
    };
  }
  const normalized = syntax.email;

  // 2) Disposable
  const disp = checkDisposable(normalized);
  if (disp.disposable) {
    return {
      email: normalized,
      status: "DISPOSABLE",
      reason: disp.reason,
      checkedAt: nowIso,
      subStatus: "NORMAL",
      riskLevel: "MEDIUM", // you might want to treat disposable as medium/high risk
    };
  }

  const [, domain] = normalized.split("@");

  // 3) MX lookup
  const mx = await checkMxRecords(domain);
  if (!mx.ok) {
    return {
      email: normalized,
      status: "UNDELIVERABLE",
      reason: mx.reason,
      checkedAt: nowIso,
      mxDomain: domain,
      subStatus: "NORMAL",
      riskLevel: "HIGH",
    };
  }

  const hosts = mx.hosts.slice(0, EMAIL_VERIFICATION_MAX_MX || 1);
  const primaryHost = hosts[0];

  // 4) Catch-all aware probe on primary MX host
  const { isCatchAll, targetResult } = await detectCatchAllForDomain(
    primaryHost,
    domain,
    normalized,
    EMAIL_VERIFICATION_TIMEOUT_MS
  );

  let finalResult = targetResult;
  let finalHost = primaryHost;

  // If still UNKNOWN, optionally try other MX hosts to reduce UNKNOWN rate
  if (finalResult.status === "UNKNOWN" && hosts.length > 1) {
    for (const host of hosts.slice(1)) {
      const r = await smtpProbe({
        host,
        from: EMAIL_VERIFICATION_FROM,
        to: normalized,
        timeoutMs: EMAIL_VERIFICATION_TIMEOUT_MS,
      });

      if (r.status === "DELIVERABLE" || r.status === "UNDELIVERABLE") {
        finalResult = r;
        finalHost = host;
        break;
      }
    }
  }

  // Derive subStatus + riskLevel
  let subStatus = "NORMAL";
  let riskLevel = "LOW";

  if (isCatchAll && finalResult.status === "DELIVERABLE") {
    subStatus = "CATCH_ALL";
    // You can tune this; typically treat catch-all as medium risk
    riskLevel = "MEDIUM";
  } else if (finalResult.status === "UNDELIVERABLE") {
    subStatus = "NORMAL";
    riskLevel = "HIGH";
  } else if (finalResult.status === "UNKNOWN") {
    subStatus = "UNKNOWN";
    riskLevel = "MEDIUM";
  }

  return {
    email: normalized,
    status: finalResult.status,
    reason: finalResult.reason,
    mxDomain: finalHost,
    subStatus,
    riskLevel,
    checkedAt: nowIso,
  };
}

/**
 * Verify many emails with limited concurrency
 */
export async function verifyEmailsBulk(emails, { concurrency = 5 } = {}) {
  const results = [];
  const queue = [...emails];

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        const res = await verifySingleEmail(next);
        results.push(res);
      } catch (err) {
        results.push({
          email: next,
          status: "UNKNOWN",
          reason: `Unexpected error: ${err.message || String(err)}`,
          checkedAt: new Date().toISOString(),
          subStatus: "UNKNOWN",
          riskLevel: "MEDIUM",
        });
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}



// // src/services/emailVerification.service.js
// import dns from "dns";
// import net from "net";
// import { promisify } from "util";

// const resolveMx = promisify(dns.resolveMx);

// // --- Env-driven config (with safe defaults) ---

// const EMAIL_VERIFICATION_FROM =
//   process.env.EMAIL_VERIFICATION_FROM || "verify@example.com";

// const EMAIL_VERIFICATION_HELO_DOMAIN =
//   process.env.EMAIL_VERIFICATION_HELO_DOMAIN || "example.com";

// const EMAIL_VERIFICATION_TIMEOUT_MS = Number(
//   process.env.EMAIL_VERIFICATION_TIMEOUT_MS || "8000"
// );

// const EMAIL_VERIFICATION_MAX_MX = Number(
//   process.env.EMAIL_VERIFICATION_MAX_MX || "2"
// );

// // --- Disposable domains list (extensible later) ---

// const DISPOSABLE_DOMAINS = new Set([
//   "mailinator.com",
//   "10minutemail.com",
//   "guerrillamail.com",
//   "tempmail.com",
//   "yopmail.com",
// ]);

// // Basic but solid syntax check
// const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// /**
//  * Step 1: Syntax validation
//  */
// function checkSyntax(email) {
//   if (!email || typeof email !== "string") {
//     return { ok: false, reason: "Empty or non-string email" };
//   }
//   const trimmed = email.trim();
//   if (!EMAIL_REGEX.test(trimmed)) {
//     return { ok: false, reason: "Invalid email syntax" };
//   }
//   return { ok: true, email: trimmed };
// }

// /**
//  * Step 2: Disposable / obvious bad domains
//  */
// function checkDisposable(email) {
//   const [, domain] = email.split("@");
//   if (!domain) return { disposable: false };

//   const lowerDomain = domain.toLowerCase();

//   if (DISPOSABLE_DOMAINS.has(lowerDomain)) {
//     return { disposable: true, reason: "Disposable / throwaway domain" };
//   }

//   return { disposable: false };
// }

// /**
//  * Step 3: MX lookup
//  */
// async function checkMxRecords(domain) {
//   try {
//     const records = await resolveMx(domain);
//     if (!records || records.length === 0) {
//       return { ok: false, reason: "No MX records for domain" };
//     }
//     // Sort by priority (lowest first)
//     const sorted = records.sort(
//       (a, b) => (a.priority || 0) - (b.priority || 0)
//     );
//     return { ok: true, hosts: sorted.map((r) => r.exchange) };
//   } catch (err) {
//     return {
//       ok: false,
//       reason: `DNS MX lookup failed: ${err.code || err.message}`,
//     };
//   }
// }

// /**
//  * Step 4: SMTP RCPT TO probe (without sending)
//  *
//  * State-machine style, using env-configured:
//  * - MAIL FROM: EMAIL_VERIFICATION_FROM
//  * - HELO: EMAIL_VERIFICATION_HELO_DOMAIN
//  */
// function smtpProbe({ host, from, to, timeoutMs }) {
//   return new Promise((resolve) => {
//     const socket = net.createConnection(25, host);
//     let buffer = "";
//     let step = "greeting"; // greeting -> helo -> mailFrom -> rcptTo -> done
//     let resolved = false;

//     const finish = (result) => {
//       if (resolved) return;
//       resolved = true;
//       try {
//         socket.end();
//       } catch (_) {}
//       resolve(result);
//     };

//     socket.setTimeout(timeoutMs, () => {
//       finish({ status: "UNKNOWN", reason: "SMTP timeout" });
//     });

//     socket.on("error", (err) => {
//       finish({
//         status: "UNKNOWN",
//         reason: `SMTP connection error: ${err.code || err.message}`,
//       });
//     });

//     socket.on("data", (data) => {
//       buffer += data.toString();
//       const lines = buffer.split(/\r?\n/).filter(Boolean);
//       const lastLine = lines[lines.length - 1] || "";

//       // Helper: parse 3-digit SMTP status code
//       const match = lastLine.match(/^(\d{3})\s/);
//       const code = match ? parseInt(match[1], 10) : null;

//       if (!code) {
//         return;
//       }

//       // 2xx, 3xx, 4xx, 5xx classification
//       const is2xx = code >= 200 && code < 300;
//       const is4xx = code >= 400 && code < 500;
//       const is5xx = code >= 500 && code < 600;

//       if (step === "greeting" && is2xx) {
//         // Send HELO
//         socket.write(`HELO ${EMAIL_VERIFICATION_HELO_DOMAIN}\r\n`);
//         step = "helo";
//         return;
//       }

//       if (step === "helo") {
//         if (is2xx) {
//           // Send MAIL FROM
//           socket.write(`MAIL FROM:<${from}>\r\n`);
//           step = "mailFrom";
//           return;
//         }
//         if (is4xx) {
//           finish({
//             status: "UNKNOWN",
//             reason: `SMTP soft failure after HELO: ${lastLine}`,
//           });
//           return;
//         }
//         if (is5xx) {
//           finish({
//             status: "UNKNOWN",
//             reason: `SMTP hard failure after HELO: ${lastLine}`,
//           });
//           return;
//         }
//       }

//       if (step === "mailFrom") {
//         if (is2xx) {
//           // Send RCPT TO
//           socket.write(`RCPT TO:<${to}>\r\n`);
//           step = "rcptTo";
//           return;
//         }
//         if (is4xx) {
//           finish({
//             status: "UNKNOWN",
//             reason: `SMTP soft failure after MAIL FROM: ${lastLine}`,
//           });
//           return;
//         }
//         if (is5xx) {
//           finish({
//             status: "UNKNOWN",
//             reason: `SMTP hard failure after MAIL FROM: ${lastLine}`,
//           });
//           return;
//         }
//       }

//       if (step === "rcptTo") {
//         // Core decision:
//         if (is2xx) {
//           socket.write("QUIT\r\n");
//           finish({ status: "DELIVERABLE", reason: "RCPT TO accepted" });
//           return;
//         }

//         // 55x are hard failures
//         if (is5xx) {
//           socket.write("QUIT\r\n");
//           finish({
//             status: "UNDELIVERABLE",
//             reason: `SMTP hard failure on RCPT TO: ${lastLine}`,
//           });
//           return;
//         }

//         // 4xx considered "UNKNOWN" (greylisting, rate limiting, etc.)
//         if (is4xx) {
//           socket.write("QUIT\r\n");
//           finish({
//             status: "UNKNOWN",
//             reason: `SMTP soft failure on RCPT TO: ${lastLine}`,
//           });
//           return;
//         }
//       }
//     });
//   });
// }

// /**
//  * Verify a *single* email address.
//  *
//  * Returns:
//  * {
//  *   email,
//  *   status: "DELIVERABLE" | "UNDELIVERABLE" | "UNKNOWN" | "INVALID_SYNTAX" | "DISPOSABLE",
//  *   reason?: string,
//  *   mxDomain?: string,
//  *   checkedAt: ISO date string
//  * }
//  */
// export async function verifySingleEmail(email) {
//   const nowIso = new Date().toISOString();

//   // 1) Syntax
//   const syntax = checkSyntax(email);
//   if (!syntax.ok) {
//     return {
//       email,
//       status: "INVALID_SYNTAX",
//       reason: syntax.reason,
//       checkedAt: nowIso,
//     };
//   }
//   const normalized = syntax.email;

//   // 2) Disposable
//   const disp = checkDisposable(normalized);
//   if (disp.disposable) {
//     return {
//       email: normalized,
//       status: "DISPOSABLE",
//       reason: disp.reason,
//       checkedAt: nowIso,
//     };
//   }

//   const [, domain] = normalized.split("@");

//   // 3) MX lookup
//   const mx = await checkMxRecords(domain);
//   if (!mx.ok) {
//     return {
//       email: normalized,
//       status: "UNDELIVERABLE",
//       reason: mx.reason,
//       checkedAt: nowIso,
//       mxDomain: domain,
//     };
//   }

//   const hosts = mx.hosts.slice(0, EMAIL_VERIFICATION_MAX_MX || 1);

//   // 4) Probe up to N MX hosts, stop once we have a decisive answer
//   const results = [];
//   for (const host of hosts) {
//     try {
//       const r = await smtpProbe({
//         host,
//         from: EMAIL_VERIFICATION_FROM,
//         to: normalized,
//         timeoutMs: EMAIL_VERIFICATION_TIMEOUT_MS,
//       });
//       results.push({ host, ...r });

//       if (r.status === "DELIVERABLE") {
//         return {
//           email: normalized,
//           status: "DELIVERABLE",
//           reason: r.reason,
//           mxDomain: host,
//           checkedAt: nowIso,
//         };
//       }

//       if (r.status === "UNDELIVERABLE") {
//         // Hard failure from at least one MX is strong signal
//         return {
//           email: normalized,
//           status: "UNDELIVERABLE",
//           reason: r.reason,
//           mxDomain: host,
//           checkedAt: nowIso,
//         };
//       }

//       // if UNKNOWN, keep trying next MX
//     } catch (err) {
//       results.push({
//         host,
//         status: "UNKNOWN",
//         reason: `Probe error: ${err.message || String(err)}`,
//       });
//     }
//   }

//   // No decisive results; aggregate reasons
//   const aggReason =
//     results.map((r) => `${r.host}: ${r.reason}`).join("; ") ||
//     "No decisive SMTP response from MX hosts";

//   return {
//     email: normalized,
//     status: "UNKNOWN",
//     reason: aggReason,
//     mxDomain: hosts[0],
//     checkedAt: nowIso,
//   };
// }

// /**
//  * Verify many emails with limited concurrency
//  */
// export async function verifyEmailsBulk(emails, { concurrency = 5 } = {}) {
//   const results = [];
//   const queue = [...emails];

//   async function worker() {
//     while (queue.length > 0) {
//       const next = queue.shift();
//       if (!next) break;
//       try {
//         const res = await verifySingleEmail(next);
//         results.push(res);
//       } catch (err) {
//         results.push({
//           email: next,
//           status: "UNKNOWN",
//           reason: `Unexpected error: ${err.message || String(err)}`,
//           checkedAt: new Date().toISOString(),
//         });
//       }
//     }
//   }

//   const workers = [];
//   for (let i = 0; i < concurrency; i++) {
//     workers.push(worker());
//   }
//   await Promise.all(workers);
//   return results;
// }



// // // src/services/emailVerification.service.js
// // import dns from "dns";
// // import net from "net";
// // import { promisify } from "util";

// // const resolveMx = promisify(dns.resolveMx);

// // /**
// //  * Disposable domains list – keep this small + extend over time.
// //  * You can move this to config or DB later.
// //  */
// // const DISPOSABLE_DOMAINS = new Set([
// //   "mailinator.com",
// //   "10minutemail.com",
// //   "guerrillamail.com",
// //   "tempmail.com",
// //   "yopmail.com",
// // ]);

// // // Basic RFC-ish email regex (not perfect, but good enough for our gate)
// // const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// // /**
// //  * Step 1: Syntax validation
// //  */
// // function checkSyntax(email) {
// //   if (!email || typeof email !== "string") {
// //     return { ok: false, reason: "Empty or non-string email" };
// //   }
// //   const trimmed = email.trim();
// //   if (!EMAIL_REGEX.test(trimmed)) {
// //     return { ok: false, reason: "Invalid email syntax" };
// //   }
// //   return { ok: true, email: trimmed };
// // }

// // /**
// //  * Step 2: Disposable / obvious bad domains
// //  */
// // function checkDisposable(email) {
// //   const [, domain] = email.split("@");
// //   if (!domain) return { disposable: false };

// //   const lowerDomain = domain.toLowerCase();

// //   if (DISPOSABLE_DOMAINS.has(lowerDomain)) {
// //     return { disposable: true, reason: "Disposable / throwaway domain" };
// //   }

// //   // You can add more heuristics here, e.g. subdomain matches
// //   return { disposable: false };
// // }

// // /**
// //  * Step 3: MX lookup
// //  */
// // async function checkMxRecords(domain) {
// //   try {
// //     const records = await resolveMx(domain);
// //     if (!records || records.length === 0) {
// //       return { ok: false, reason: "No MX records for domain" };
// //     }
// //     // Sort by priority (lowest first)
// //     const sorted = records.sort((a, b) => (a.priority || 0) - (b.priority || 0));
// //     return { ok: true, hosts: sorted.map((r) => r.exchange) };
// //   } catch (err) {
// //     // No MX at all OR DNS failure
// //     return { ok: false, reason: `DNS MX lookup failed: ${err.code || err.message}` };
// //   }
// // }

// // /**
// //  * Step 4: SMTP RCPT TO probe (without sending)
// //  * We keep it conservative:
// //  * - Short timeouts
// //  * - If servers are strict / rate-limiting, we classify as UNKNOWN (not UNDELIVERABLE)
// //  */

// // function smtpProbe({ host, from, to, timeoutMs = 8000 }) {
// //   return new Promise((resolve) => {
// //     const socket = net.createConnection(25, host);
// //     let response = "";
// //     let resolved = false;

// //     const finish = (result) => {
// //       if (resolved) return;
// //       resolved = true;
// //       try {
// //         socket.end();
// //       } catch (_) {}
// //       resolve(result);
// //     };

// //     socket.setTimeout(timeoutMs, () => {
// //       finish({ status: "UNKNOWN", reason: "SMTP timeout" });
// //     });

// //     socket.on("error", (err) => {
// //       finish({
// //         status: "UNKNOWN",
// //         reason: `SMTP connection error: ${err.code || err.message}`,
// //       });
// //     });

// //     socket.on("data", (data) => {
// //       response += data.toString();

// //       // We parse line-by-line. Very primitive but works for our use.
// //       const lines = response.split(/\r?\n/).filter(Boolean);
// //       const lastLine = lines[lines.length - 1] || "";

// //       if (/^220 /.test(lastLine)) {
// //         // Greet
// //         socket.write(`HELO verifier.salefunnel\r\n`);
// //         return;
// //       }
// //       if (/^250 /.test(lastLine)) {
// //         // After HELO, send MAIL FROM
// //         if (response.includes("HELO verifier.salefunnel")) {
// //           socket.write(`MAIL FROM:<${from}>\r\n`);
// //           return;
// //         }

// //         // After MAIL FROM accepted, send RCPT TO
// //         if (response.includes("MAIL FROM:<")) {
// //           socket.write(`RCPT TO:<${to}>\r\n`);
// //           return;
// //         }
// //       }

// //       // RCPT response codes
// //       if (/^250 /.test(lastLine) && response.includes("RCPT TO:<")) {
// //         // Accepted – good sign
// //         socket.write("QUIT\r\n");
// //         finish({ status: "DELIVERABLE", reason: "RCPT TO accepted" });
// //         return;
// //       }

// //       if (/^550 /.test(lastLine) || /^551 /.test(lastLine) || /^552 /.test(lastLine) || /^553 /.test(lastLine)) {
// //         // Hard failure codes
// //         socket.write("QUIT\r\n");
// //         finish({
// //           status: "UNDELIVERABLE",
// //           reason: `SMTP hard failure: ${lastLine}`,
// //         });
// //         return;
// //       }

// //       // 450-499 range could be temp failures / greylisting. Mark as UNKNOWN.
// //       if (/^4\d\d /.test(lastLine)) {
// //         socket.write("QUIT\r\n");
// //         finish({
// //           status: "UNKNOWN",
// //           reason: `SMTP soft failure: ${lastLine}`,
// //         });
// //         return;
// //       }
// //     });
// //   });
// // }

// // /**
// //  * Verify single email
// //  * Return shape:
// //  * {
// //  *   email,
// //  *   status: "DELIVERABLE" | "UNDELIVERABLE" | "UNKNOWN" | "INVALID_SYNTAX" | "DISPOSABLE",
// //  *   reason?: string,
// //  *   mxDomain?: string,
// //  *   checkedAt: ISO date string
// //  * }
// //  */
// // export async function verifySingleEmail(email) {
// //   const nowIso = new Date().toISOString();

// //   // 1) Syntax
// //   const syntax = checkSyntax(email);
// //   if (!syntax.ok) {
// //     return {
// //       email,
// //       status: "INVALID_SYNTAX",
// //       reason: syntax.reason,
// //       checkedAt: nowIso,
// //     };
// //   }
// //   const normalized = syntax.email;

// //   // 2) Disposable
// //   const disp = checkDisposable(normalized);
// //   if (disp.disposable) {
// //     return {
// //       email: normalized,
// //       status: "DISPOSABLE",
// //       reason: disp.reason,
// //       checkedAt: nowIso,
// //     };
// //   }

// //   const [, domain] = normalized.split("@");

// //   // 3) MX
// //   const mx = await checkMxRecords(domain);
// //   if (!mx.ok) {
// //     return {
// //       email: normalized,
// //       status: "UNDELIVERABLE",
// //       reason: mx.reason,
// //       checkedAt: nowIso,
// //       mxDomain: domain,
// //     };
// //   }

// //   // 4) SMTP probe with the best MX host
// //   const mxHost = mx.hosts[0];
// //   const smtpResult = await smtpProbe({
// //     host: mxHost,
// //     from: `nullsender@${domain}`, // safe null-ish sender
// //     to: normalized,
// //   });

// //   // We treat DELIVERABLE vs UNDELIVERABLE vs UNKNOWN as-is from probe
// //   return {
// //     email: normalized,
// //     status: smtpResult.status,
// //     reason: smtpResult.reason,
// //     mxDomain: mxHost,
// //     checkedAt: nowIso,
// //   };
// // }

// // /**
// //  * Verify many emails with limited concurrency (to avoid hammering your server / remote MX servers)
// //  */
// // export async function verifyEmailsBulk(emails, { concurrency = 5 } = {}) {
// //   const results = [];
// //   const queue = [...emails];

// //   async function worker() {
// //     while (queue.length > 0) {
// //       const next = queue.shift();
// //       if (!next) break;
// //       try {
// //         const res = await verifySingleEmail(next);
// //         results.push(res);
// //       } catch (err) {
// //         results.push({
// //           email: next,
// //           status: "UNKNOWN",
// //           reason: `Unexpected error: ${err.message || String(err)}`,
// //           checkedAt: new Date().toISOString(),
// //         });
// //       }
// //     }
// //   }

// //   const workers = [];
// //   for (let i = 0; i < concurrency; i++) {
// //     workers.push(worker());
// //   }
// //   await Promise.all(workers);
// //   return results;
// // }
