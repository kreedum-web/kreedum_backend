/**
 * Sends Kreedum's emails (sign-up codes, password reset codes, order
 * confirmations) through any SMTP service, set in .env:
 *
 *   Gmail (no company domain needed; ~500 recipients a day):
 *     SMTP_USER=yourname@gmail.com
 *     SMTP_PASS=<16-letter Google App Password>
 *
 *   Any other provider later (Brevo, Resend, Zoho …) — only .env changes:
 *     SMTP_HOST=smtp-relay.brevo.com   SMTP_PORT=587
 *     SMTP_USER=…                      SMTP_PASS=…
 *     MAIL_FROM="Kreedum Sports <no-reply@yourdomain.in>"
 *
 * Without SMTP_USER / SMTP_PASS (e.g. on a laptop) nothing is sent: the email
 * is printed in the terminal instead, so codes can still be tested.
 */
const nodemailer = require("nodemailer");

let transport;
let testTransport = null;

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

function getTransport() {
  if (testTransport) return testTransport;
  if (transport === undefined) {
    const settings = smtpSettings();
    transport = settings ? nodemailer.createTransport(settings) : null;
  }
  return transport;
}

function fromAddress(env = process.env) {
  return env.MAIL_FROM || `Kreedum Sports <${(env.SMTP_USER || "no-reply@kreedum.local").trim()}>`;
}

/**
 * @param {{ to: string, subject: string, html: string, text: string }} message
 * @returns {Promise<{ sent: boolean, messageId?: string }>}
 */
async function sendMail({ to, subject, html, text }) {
  const smtp = getTransport();

  if (!smtp) {
    console.log(`\n📧 Email NOT sent (SMTP_USER / SMTP_PASS not set in .env)\n   To: ${to}\n   Subject: ${subject}\n${text}\n`);
    return { sent: false };
  }

  const info = await smtp.sendMail({
    from: fromAddress(),
    to,
    subject,
    html,
    text,
    ...(process.env.MAIL_REPLY_TO ? { replyTo: process.env.MAIL_REPLY_TO } : {}),
  });
  return { sent: true, messageId: info.messageId };
}

/** Tests: capture emails instead of sending them. Pass null to reset. */
function setTestTransport(fake) {
  testTransport = fake;
}

module.exports = { sendMail, smtpSettings, fromAddress, setTestTransport };
