/**
 * Sends Kreedum's emails (sign-up codes, password reset codes, order
 * confirmations). How they're sent is chosen by .env, first match wins:
 *
 *  1. Resend (needs your own domain), over HTTPS:
 *       RESEND_API_KEY=re_…
 *       MAIL_FROM="Kreedum Sports <orders@yourdomain.in>"
 *
 *  2. Gmail API, over HTTPS (works on Render's free plan, which blocks SMTP):
 *       GMAIL_USER=kreedumsports@gmail.com
 *       GMAIL_CLIENT_ID=…  GMAIL_CLIENT_SECRET=…
 *       GMAIL_REFRESH_TOKEN=…   (from `npm run gmail:token`)
 *
 *  3. SMTP, e.g. Gmail with an App Password (fine locally / on paid hosting):
 *       SMTP_USER=kreedumsports@gmail.com   SMTP_PASS=<App Password>
 *       (any provider: SMTP_HOST=…  SMTP_PORT=587)
 *
 *  None of these set: nothing is sent, the email is printed in the terminal.
 *
 * MAIL_TRANSPORT=resend | gmail-api | smtp | log forces one of them.
 */
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");

let smtpTransport;
let testTransport = null;
let gmailToken = null; // { accessToken, expiresAt }

// ---------------------------------------------------------------- settings

function smtpSettings(env = process.env) {
  const user = (env.SMTP_USER || "").trim();
  // Google shows App Passwords as "abcd efgh ijkl mnop": spaces aren't part of it.
  const pass = (env.SMTP_PASS || "").replace(/\s+/g, "");
  if (!user || !pass) return null;

  const auth = { user, pass };
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    return { host: env.SMTP_HOST, port, secure: port === 465, auth };
  }
  return { service: env.SMTP_SERVICE || "gmail", auth };
}

/** Which way emails go out with these settings. */
function transportName(env = process.env) {
  if (env.MAIL_TRANSPORT) return env.MAIL_TRANSPORT;
  if (env.RESEND_API_KEY) return "resend";
  if (env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET) return "gmail-api";
  if (smtpSettings(env)) return "smtp";
  return "log";
}

function fromAddress(env = process.env) {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  const address = (env.GMAIL_USER || env.SMTP_USER || "no-reply@kreedum.local").trim();
  return `Kreedum Sports <${address}>`;
}

// ---------------------------------------------------------------- senders

async function sendWithSmtp(message) {
  if (smtpTransport === undefined) smtpTransport = nodemailer.createTransport(smtpSettings());
  const info = await smtpTransport.sendMail(message);
  return info.messageId;
}

/** Short-lived Gmail access token from the long-lived refresh token (cached until shortly before expiry). */
async function gmailAccessToken(env = process.env) {
  if (gmailToken && gmailToken.expiresAt > Date.now() + 60 * 1000) return gmailToken.accessToken;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // invalid_grant: the refresh token was revoked or expired (e.g. the Google
    // Cloud app is still in "Testing", where tokens last 7 days).
    const reason = String(data.error_description || data.error || response.status).replace(/\.$/, "");
    throw new Error(`Gmail sign-in failed: ${reason}. Run npm run gmail:token again.`);
  }
  gmailToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return gmailToken.accessToken;
}

function buildRawEmail(message) {
  return new Promise((resolve, reject) => {
    new MailComposer(message).compile().build((error, raw) => (error ? reject(error) : resolve(raw)));
  });
}

async function sendWithGmailApi(message) {
  const raw = (await buildRawEmail(message)).toString("base64url");
  const token = await gmailAccessToken();
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) gmailToken = null; // get a fresh token next time
    throw new Error(`Gmail API: ${data.error?.message || response.status}`);
  }
  return data.id;
}

async function sendWithResend(message) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend: ${data.message || response.status}`);
  return data.id;
}

// ---------------------------------------------------------------- public

/**
 * @param {{ to: string, subject: string, html: string, text: string }} email
 * @returns {Promise<{ sent: boolean, via: string, messageId?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
  const message = {
    from: fromAddress(),
    to,
    subject,
    html,
    text,
    ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
  };

  if (testTransport) {
    const info = await testTransport.sendMail(message);
    return { sent: true, via: "test", messageId: info?.messageId };
  }

  const via = transportName();
  if (via === "log") {
    console.log(`\n📧 Email NOT sent (no email settings in .env)\n   To: ${to}\n   Subject: ${subject}\n${text}\n`);
    return { sent: false, via };
  }

  const send = { resend: sendWithResend, "gmail-api": sendWithGmailApi, smtp: sendWithSmtp }[via];
  if (!send) throw new Error(`Unknown MAIL_TRANSPORT "${via}"`);
  return { sent: true, via, messageId: await send(message) };
}

/** Tests: capture emails instead of sending them. Pass null to reset. */
function setTestTransport(fake) {
  testTransport = fake;
}

/** Tests: forget the cached Gmail token. */
function resetGmailToken() {
  gmailToken = null;
}

module.exports = { sendMail, smtpSettings, transportName, fromAddress, buildRawEmail, setTestTransport, resetGmailToken };
