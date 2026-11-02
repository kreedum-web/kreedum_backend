/**
 * "Continue with Google": the website gets a signed Google ID token for the
 * customer and sends it here. We ask Google to check it (tokeninfo endpoint,
 * HTTPS, free) and accept it only if it was made for OUR client id.
 *
 * Needs GOOGLE_CLIENT_ID in .env: the "Web application" OAuth client from
 * Google Cloud → Google Auth Platform → Clients (not the Desktop one used
 * for sending email).
 */
const HttpError = require("./httpError");

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

function googleClientId(env = process.env) {
  return (env.GOOGLE_CLIENT_ID || "").trim();
}

/**
 * @param {string} credential the ID token from Google's sign-in button
 * @returns {Promise<{ googleId, email, firstName, lastName, avatarUrl }>}
 */
async function verifyGoogleCredential(credential, env = process.env) {
  const clientId = googleClientId(env);
  if (!clientId) throw new HttpError(503, "Google sign-in isn't set up yet.", "GOOGLE_NOT_CONFIGURED");
  if (!credential || typeof credential !== "string") {
    throw new HttpError(400, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");
  }

  let response;
  try {
    response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  } catch (error) {
    console.error("Google tokeninfo unreachable:", error.message);
    throw new HttpError(502, "Couldn't reach Google. Please try again.", "GOOGLE_UNREACHABLE");
  }
  const info = await response.json().catch(() => ({}));

  const valid =
    response.ok &&
    info.aud === clientId &&
    ISSUERS.has(info.iss) &&
    Number(info.exp) * 1000 > Date.now() &&
    info.sub &&
    info.email;
  if (!valid) throw new HttpError(401, "Google sign-in failed. Please try again.", "GOOGLE_TOKEN_INVALID");

  if (String(info.email_verified) !== "true") {
    throw new HttpError(401, "This Google account's email isn't verified.", "GOOGLE_EMAIL_UNVERIFIED");
  }

  return {
    googleId: info.sub,
    email: String(info.email).toLowerCase(),
    firstName: info.given_name || "",
    lastName: info.family_name || "",
    avatarUrl: info.picture || "",
  };
}

module.exports = { verifyGoogleCredential, googleClientId };
