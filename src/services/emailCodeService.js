const crypto = require("crypto");

const EmailCode = require("../models/EmailCode");
const HttpError = require("../utils/httpError");

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;

function hashCode(email, purpose, code) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET || "kreedum")
    .update(`${purpose}:${email}:${code}`)
    .digest("hex");
}

/**
 * One-time email codes: 6 digits, valid 10 minutes, 5 tries, a new code at
 * most once a minute and 5 times an hour per email address.
 */
class EmailCodeService {
  /** Create a code for this email + purpose (replaces any earlier one). Returns the plain code. */
  async issue(email, purpose, now = new Date()) {
    email = String(email).toLowerCase().trim();
    const existing = await EmailCode.findOne({ email, purpose });

    let sendCount = 1;
    let windowStart = now;

    if (existing) {
      const secondsSinceLast = (now - new Date(existing.lastSentAt)) / 1000;
      if (secondsSinceLast < RESEND_SECONDS) {
        const wait = Math.ceil(RESEND_SECONDS - secondsSinceLast);
        throw new HttpError(429, `Please wait ${wait} seconds before asking for a new code.`, "CODE_COOLDOWN", { retryAfter: wait });
      }
      const inWindow = now - new Date(existing.windowStart) < 3600 * 1000;
      if (inWindow) {
        if (existing.sendCount >= MAX_PER_HOUR) {
          throw new HttpError(429, "Too many codes requested. Please try again in an hour.", "CODE_LIMIT");
        }
        sendCount = existing.sendCount + 1;
        windowStart = existing.windowStart;
      }
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

    await EmailCode.updateOne(
      { email, purpose },
      {
        $set: {
          email,
          purpose,
          codeHash: hashCode(email, purpose, code),
          expiresAt: new Date(now.getTime() + CODE_MINUTES * 60 * 1000),
          attempts: 0,
          sendCount,
          windowStart,
          lastSentAt: now,
        },
      },
      { upsert: true }
    );

    return code;
  }

  /** Check a code. Correct: the code is used up. Wrong: throws with tries left. */
  async verify(email, purpose, code, now = new Date()) {
    email = String(email || "").toLowerCase().trim();
    code = String(code || "").replace(/\D/g, "");

    const entry = await EmailCode.findOne({ email, purpose });
    if (!entry || !entry.codeHash || new Date(entry.expiresAt) < now) {
      throw new HttpError(400, "This code has expired. Please ask for a new one.", "CODE_EXPIRED");
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(400, "Too many wrong codes. Please ask for a new one.", "CODE_LOCKED");
    }

    const expected = Buffer.from(entry.codeHash, "hex");
    const given = Buffer.from(hashCode(email, purpose, code), "hex");
    if (code.length !== 6 || !crypto.timingSafeEqual(expected, given)) {
      const attempts = entry.attempts + 1;
      await EmailCode.updateOne({ email, purpose }, { $set: { attempts } });
      const left = MAX_ATTEMPTS - attempts;
      throw new HttpError(
        400,
        left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Please ask for a new one.",
        left > 0 ? "CODE_WRONG" : "CODE_LOCKED"
      );
    }

    // Used up, but the send counters stay for the hourly limit.
    await EmailCode.updateOne({ email, purpose }, { $set: { codeHash: "", expiresAt: now } });
    return true;
  }
}

module.exports = new EmailCodeService();
module.exports.CODE_MINUTES = CODE_MINUTES;
