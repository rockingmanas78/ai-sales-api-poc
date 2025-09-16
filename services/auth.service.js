import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI; // e.g., http://localhost:8080/auth/google/callback

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error("Missing Google OAuth environment variables");
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);

/**
 * Generate Google OAuth URL with a backend-managed state
 */
export function getGoogleAuthUrl(state) {
  // console.log("[GoogleAuthStart] getGoogleAuthUrl called with state:", state);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // request refresh token
    scope: ["profile", "email"],
    state,
    prompt: "consent", // forces consent every login
  });
  // console.log("[GoogleAuthStart] Generated Google OAuth URL:", url);
  return url;
}

/**
 * Exchange code for tokens and verify user
 */
export async function handleGoogleLogin(code) {
  // console.log("[GoogleAuth] handleGoogleLogin called with code:", code);
  if (!code) {
    console.error("[GoogleAuth] No code provided to handleGoogleLogin");
    throw new Error("Missing authorization code");
  }

  let tokens;
  try {
    // console.log("[GoogleAuth] Requesting tokens from Google...");
    const result = await oauth2Client.getToken({
      code,
      redirect_uri: redirectUri,
    });
    tokens = result.tokens;
    // console.log("[GoogleAuth] Tokens received:", tokens);
  } catch (err) {
    console.error("[GoogleAuth] Error getting tokens from Google:", err);
    throw err;
  }

  oauth2Client.setCredentials(tokens);

  if (!tokens.id_token) {
    console.error(
      "[GoogleAuth] No ID token returned from Google. Tokens:",
      tokens
    );
    throw new Error("No ID token returned from Google");
  }

  let ticket;
  try {
    // console.log("[GoogleAuth] Verifying ID token...");
    ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });
    // console.log("[GoogleAuth] ID token verified.");
  } catch (err) {
    console.error("[GoogleAuth] Error verifying ID token:", err);
    throw err;
  }

  const payload = ticket.getPayload();
  const email = payload.email;
  const sub = payload.sub;
  // console.log("[GoogleAuth] Token payload:", payload);

  if (!email || !sub) {
    console.error(
      "[GoogleAuth] Missing email or sub in token payload:",
      payload
    );
    throw new Error("Missing email or sub in token payload");
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    // LOGIN
    // console.log(`[GoogleAuth] User exists, logging in: ${email}`);
  } else {
    // User does not exist: return username and email to frontend for onboarding
    const name =
      payload.name || payload.given_name || payload.family_name || "";
    // Optionally, generate a tempToken for secure onboarding
    const tempToken = jwt.sign(
      {
        email,
        name,
        sub,
        // You can add more Google info if needed
      },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
    );
    return {
      needsOnboarding: true,
      email,
      name,
      tempToken,
    };
  }

  // Generate app JWT
  let appToken;
  try {
    // console.log("[GoogleAuth] Generating JWT for user:", user.email);
    appToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    // console.log("[GoogleAuth] JWT generated.");
  } catch (err) {
    console.error("[GoogleAuth] Error generating JWT:", err);
    throw err;
  }

  // oauthId = payload.sub when we add in schema

  // console.log("[GoogleAuth] handleGoogleLogin completed for:", email);
  return { user, token: appToken };
}
