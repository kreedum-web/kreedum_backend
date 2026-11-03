/**
 * Sign in with a phone number (OTP). Two ways, chosen by .env:
 *
 *  1. Firebase (now): the website asks Firebase to send and check the SMS,
 *     then sends us Firebase's signed ID token, which we check here.
 *       FIREBASE_PROJECT_ID=kreedum-sports
 *       FIREBASE_API_KEY=AIza…          (public web key, not a secret)
 *       FIREBASE_APP_ID=1:…:web:…        (optional)
 *       FIREBASE_AUTH_DOMAIN=…           (optional, default <project>.firebaseapp.com)
 *
 *  2. Our own SMS (later, e.g. a local Indian provider): we make the code,
 *     send it with sendSms() and check it ourselves.
 *       SMS_TRANSPORT=log               prints the code in the terminal (testing)
 *       (a provider is added as one more sender in sendSms)
 *
 * PHONE_PROVIDER=firebase | sms forces one of them.
 */
const jwt = require("jsonwebtoken");
const HttpError = require("./httpError");

// ---------------------------------------------------------------- numbers

/** "98765 43210", "+91 98765-43210", "09876543210" → "9876543210" (Indian mobiles only). */
function normalizeIndianPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const toE164 = (tenDigits) => `+91${tenDigits}`;

// ---------------------------------------------------------------- settings

function firebaseWebConfig(env = process.env) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const apiKey = (env.FIREBASE_API_KEY || "").trim();
  if (!projectId || !apiKey) return null;
  return {
    apiKey,
    authDomain: (env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim(),
    projectId,
    ...(env.FIREBASE_APP_ID ? { appId: env.FIREBASE_APP_ID.trim() } : {}),
  };
}

/** "firebase", "sms" or null (phone sign-in hidden). */
function phoneProvider(env = process.env) {
  if (env.PHONE_PROVIDER) return env.PHONE_PROVIDER === "off" ? null : env.PHONE_PROVIDER;
  if (firebaseWebConfig(env)) return "firebase";
  if (env.SMS_TRANSPORT) return "sms";
  return null;
}

// ---------------------------------------------------------------- Firebase

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certCache = null; // { certs, expiresAt }

async function firebaseCerts() {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error(`Firebase keys: HTTP ${response.status}`);
  const certs = await response.json();
  const maxAge = Number((response.headers?.get?.("cache-control") || "").match(/max-age=(\d+)/)?.[1]) || 3600;
  certCache = { certs, expiresAt: Date.now() + maxAge * 1000 };
  return certs;
}

/**
 * Check a Firebase ID token the way Google documents it (RS256, signed by
 * Google's securetoken keys, made for OUR project, phone number inside).
 * @returns {Promise<string>} the 10-digit phone number
 */
async function verifyFirebasePhoneToken(idToken, env = process.env) {
  const config = firebaseWebConfig(env);
  if (!config) throw new HttpError(503, "Phone sign-in isn't set up yet.", "PHONE_NOT_CONFIGURED");
  const invalid = () => new HttpError(401, "Phone verification failed. Please try again.", "PHONE_TOKEN_INVALID");
  if (!idToken || typeof idToken !== "string") throw invalid();

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw invalid();

  let certs;
  try {
    certs = await firebaseCerts();
  } catch (error) {
    console.error("Firebase keys unreachable:", error.message);
    throw new HttpError(502, "Couldn't reach Google. Please try again.", "PHONE_UNREACHABLE");
  }
  const cert = certs[decoded.header.kid];
  if (!cert) {
    certCache = null; // keys may have rotated; fetch fresh ones next time
    throw invalid();
  }

  let payload;
  try {
    payload = jwt.verify(idToken, cert, {
      algorithms: ["RS256"],
      audience: config.projectId,
      issuer: `https://securetoken.google.com/${config.projectId}`,
    });
  } catch {
    throw invalid();
  }
  if (!payload.sub || (payload.auth_time && payload.auth_time * 1000 > Date.now() + 60 * 1000)) throw invalid();

  const phone = normalizeIndianPhone(payload.phone_number);
  if (!phone) throw new HttpError(400, "Please use an Indian mobile number (+91).", "PHONE_NOT_INDIAN");
  return phone;
}

// ---------------------------------------------------------------- own SMS

let testSender = null;

/** Send an SMS with the provider in SMS_TRANSPORT. Returns { sent, via }. */
async function sendSms({ to, text }, env = process.env) {
  if (testSender) {
    await testSender({ to, text });
    return { sent: true, via: "test" };
  }
  const via = env.SMS_TRANSPORT || "log";
  if (via === "log") {
    console.log(`\n📱 SMS NOT sent (SMS_TRANSPORT=log)\n   To: ${to}\n   ${text}\n`);
    return { sent: false, via };
  }
  // A real provider goes here, e.g.:
  //   if (via === "localprovider") return sendWithLocalProvider({ to, text });
  throw new Error(`Unknown SMS_TRANSPORT "${via}"`);
}

/** Tests: capture SMS instead of sending. Pass null to reset. */
function setTestSmsSender(fake) {
  testSender = fake;
}

/** Tests: forget cached Firebase keys. */
function resetFirebaseCerts() {
  certCache = null;
}

module.exports = {
  normalizeIndianPhone,
  toE164,
  firebaseWebConfig,
  phoneProvider,
  verifyFirebasePhoneToken,
  sendSms,
  setTestSmsSender,
  resetFirebaseCerts,
};
