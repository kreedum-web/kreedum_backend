/**
 * Customer accounts.
 *
 * An account signs in with ONE credential, the one it was created with:
 * an email address or a mobile number, plus a password (or Google).
 * OTP codes are used only to prove the email/phone belongs to the person:
 *   - when creating an account,
 *   - when setting or resetting a password.
 * Signing in to an existing account never sends a code (saves SMS cost).
 *
 * Phone and email typed in a delivery address are only for that delivery and
 * its emails; they never become a way to sign in.
 */
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { generateToken } = require("../utils/jwt");
const HttpError = require("../utils/httpError");
const emailCodeService = require("./emailCodeService");
const { CODE_MINUTES } = require("./emailCodeService");
const { sendMail } = require("../utils/mailer");
const { verificationCodeEmail, passwordResetCodeEmail } = require("../emails/templates");
const { verifyGoogleCredential } = require("../utils/googleAuth");
const phoneAuth = require("../utils/phoneAuth");

const MIN_PASSWORD = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();

// ---------------------------------------------------------------- helpers

/** "asha@gmail.com" → email · "98765 43210" / "+91…" → phone · else null. */
function parseIdentifier(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    return EMAIL_PATTERN.test(email) ? { type: "email", value: email } : null;
  }
  const phone = phoneAuth.normalizeIndianPhone(raw);
  return phone ? { type: "phone", value: phone } : null;
}

function requireIdentifier(value) {
  const id = parseIdentifier(value);
  if (!id) {
    throw new HttpError(400, "Enter a valid email address or 10-digit mobile number.", "INVALID_IDENTIFIER");
  }
  return id;
}

/** The account that signs in with this email / phone (unfinished sign-ups excluded). */
async function findAccount(id, withPassword = false) {
  const query = id.type === "email" ? { email: id.value } : { phone: id.value, phoneVerified: true };
  const found = User.findOne(query);
  return withPassword ? found.select("+password +googleId") : found;
}

function checkPassword(password) {
  if (typeof password !== "string" || password.trim().length === 0 || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters long.`, "WEAK_PASSWORD");
  }
}

/** How this account signs in. */
function loginMethod(user) {
  if (user.email) return "email";
  if (user.phoneVerified) return "phone";
  return "email";
}

function publicUser(user) {
  return {
    id: user._id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    avatarUrl: user.avatarUrl || "",
    loginMethod: loginMethod(user),
    hasPassword: Boolean(user.password),
    googleLinked: Boolean(user.googleId),
  };
}

function signedIn(user, extra = {}) {
  return { user: publicUser(user), token: generateToken(user), ...extra };
}

function refuseInactive(user) {
  if (user.isActive === false) {
    throw new HttpError(403, "This account has been disabled. Please contact Kreedum Sports.", "ACCOUNT_DISABLED");
  }
}

async function sendCodeEmail(to, build, purpose, name) {
  const code = await emailCodeService.issue(to, purpose);
  try {
    await sendMail({ to, ...build({ name, code, minutes: CODE_MINUTES }) });
  } catch (error) {
    console.error(`${purpose} email failed:`, error.message);
    throw new HttpError(502, "We couldn't send the code email right now. Please try again in a minute.", "EMAIL_SEND_FAILED");
  }
}

/** A code sent less than a minute ago still works: don't treat the cooldown as a failure. */
async function sendCodeIgnoringCooldown(send) {
  try {
    await send();
  } catch (error) {
    if (error.code !== "CODE_COOLDOWN") throw error;
  }
}

/**
 * Proof that the customer owns a mobile number:
 *   Firebase (now): { idToken } from the website after the SMS code.
 *   Own SMS provider (later): { phone, code } sent with /auth/phone/start.
 * @returns {Promise<string>} the 10-digit number
 */
async function provePhone({ idToken, phone, code }) {
  if (phoneAuth.phoneProvider() === "firebase") return phoneAuth.verifyFirebasePhoneToken(idToken);
  if (phoneAuth.phoneProvider() === "sms") {
    const number = phoneAuth.normalizeIndianPhone(phone);
    if (!number) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.", "INVALID_PHONE");
    await emailCodeService.verify(phoneAuth.toE164(number), "phone_login", code);
    return number;
  }
  throw new HttpError(503, "Mobile number sign-up isn't available yet. Please use email.", "PHONE_NOT_CONFIGURED");
}

// Accept strict date-only ISO strings to avoid ambiguous date parsing.
function parseBirthday(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Birthday must be a valid date in YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Birthday is not a valid calendar date.");
  }

  const today = new Date();
  if (date.getTime() > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) {
    throw new Error("Birthday cannot be in the future.");
  }

  return date;
}

function serializeBirthday(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------- service

class AuthService {
  // ----------------------------
  // Step 1 of the sign-in page: is this email / number already a customer?
  // ----------------------------
  async identify(identifier) {
    const id = requireIdentifier(identifier);
    const user = await findAccount(id, true);
    // An email sign-up that never entered its code doesn't count yet.
    const exists = Boolean(user) && !(id.type === "email" && user.emailVerified === false);
    if (exists) refuseInactive(user);
    return {
      type: id.type,
      value: id.value,
      exists,
      hasPassword: exists ? Boolean(user.password) : false,
      googleLinked: exists ? Boolean(user.googleId) : false,
    };
  }

  // ----------------------------
  // Sign in with email or phone + password (no code)
  // ----------------------------
  async login(identifier, password) {
    const id = requireIdentifier(identifier);
    if (!password) throw new HttpError(400, "Enter your password.", "PASSWORD_REQUIRED");

    const user = await findAccount(id, true);
    if (!user || (id.type === "email" && user.emailVerified === false && !user.password)) {
      throw new HttpError(404, `No account found for this ${id.type === "email" ? "email" : "mobile number"}. Create one instead.`, "ACCOUNT_NOT_FOUND");
    }
    refuseInactive(user);

    if (!user.password) {
      throw new HttpError(400, "This account doesn't have a password yet. Set one to continue.", "NO_PASSWORD", {
        identifier: id.value,
      });
    }

    if (!(await bcrypt.compare(password, user.password))) {
      throw new HttpError(401, "Wrong password. Try again or reset it.", "WRONG_PASSWORD");
    }

    // Signed up by email but never entered the code: send one and ask for it.
    if (user.emailVerified === false) {
      await sendCodeIgnoringCooldown(() => sendCodeEmail(user.email, verificationCodeEmail, "verify_email", user.firstName));
      throw new HttpError(403, "Please verify your email first. We've sent a code to your inbox.", "EMAIL_NOT_VERIFIED", {
        email: user.email,
      });
    }

    user.lastLoginAt = new Date();
    await user.save();
    return signedIn(user);
  }

  // ----------------------------
  // Create an account with email + password: the account is usable once
  // the emailed code is entered (verifyEmail).
  // ----------------------------
  async register({ email, password, firstName = "", lastName = "" }) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
    checkPassword(password);

    const existing = await User.findOne({ email: normalized });
    if (existing && existing.emailVerified !== false) {
      throw new HttpError(409, "This email already has an account. Sign in instead.", "ACCOUNT_EXISTS");
    }

    const details = {
      email: normalized,
      password: await bcrypt.hash(password, 10),
      emailVerified: false,
      ...(firstName ? { firstName: String(firstName).trim() } : {}),
      ...(lastName ? { lastName: String(lastName).trim() } : {}),
    };

    let user;
    if (existing) {
      // Signed up before but never entered the code: start over with the new password.
      Object.assign(existing, details);
      user = await existing.save();
    } else {
      user = await User.create(details);
    }

    await sendCodeEmail(user.email, verificationCodeEmail, "verify_email", user.firstName);
    return { requiresVerification: true, email: user.email };
  }

  /** The emailed code finishes an email sign-up and signs in. */
  async verifyEmail(email, code) {
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user) throw new HttpError(400, "This code has expired. Please ask for a new one.", "CODE_EXPIRED");
    if (user.emailVerified !== false) {
      throw new HttpError(409, "This email is already verified. Please sign in.", "ALREADY_VERIFIED");
    }

    await emailCodeService.verify(user.email, "verify_email", code);

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.lastLoginAt = new Date();
    await user.save();

    return signedIn(user, { isNew: true });
  }

  async resendVerificationCode(email) {
    const user = await User.findOne({ email: normalizeEmail(email) });
    // Same answer whether or not the account exists.
    if (!user || user.emailVerified !== false) return { sent: true };
    await sendCodeEmail(user.email, verificationCodeEmail, "verify_email", user.firstName);
    return { sent: true };
  }

  // ----------------------------
  // Create an account with mobile number + password: the SMS code is
  // checked first (Firebase on the website, or our own SMS), then the
  // account is made.
  // ----------------------------
  async registerPhone({ password, firstName = "", lastName = "", ...proof }) {
    checkPassword(password);
    const phone = await provePhone(proof);

    const existing = await User.findOne({ phone, phoneVerified: true });
    if (existing) {
      throw new HttpError(409, "This mobile number already has an account. Sign in instead.", "ACCOUNT_EXISTS");
    }

    const user = await User.create({
      phone,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      password: await bcrypt.hash(password, 10),
      ...(firstName ? { firstName: String(firstName).trim() } : {}),
      ...(lastName ? { lastName: String(lastName).trim() } : {}),
      lastLoginAt: new Date(),
    });
    return signedIn(user, { isNew: true });
  }

  /** Own SMS provider only: send the code (Firebase sends its own). */
  async startPhoneCode(rawPhone) {
    if (phoneAuth.phoneProvider() !== "sms") {
      throw new HttpError(400, "SMS codes are sent by Firebase on this site.", "PHONE_PROVIDER_FIREBASE");
    }
    const phone = phoneAuth.normalizeIndianPhone(rawPhone);
    if (!phone) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.", "INVALID_PHONE");

    const code = await emailCodeService.issue(phoneAuth.toE164(phone), "phone_login");
    try {
      await phoneAuth.sendSms({
        to: phoneAuth.toE164(phone),
        text: `${code} is your Kreedum Sports verification code. It expires in ${CODE_MINUTES} minutes. Don't share it with anyone.`,
      });
    } catch (error) {
      console.error("Verification SMS failed:", error.message);
      throw new HttpError(502, "We couldn't send the SMS right now. Please try again in a minute.", "SMS_SEND_FAILED");
    }
    return { sent: true, phone };
  }

  // ----------------------------
  // Forgot / set password
  // ----------------------------

  /** Email a reset code (also for email accounts that never had a password). */
  async forgotPassword(email) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");

    const user = await User.findOne({ email: normalized });
    // Same answer whether or not the account exists, so emails can't be probed here.
    if (!user || user.isActive === false) return { sent: true };

    await sendCodeEmail(user.email, passwordResetCodeEmail, "reset_password", user.firstName);
    return { sent: true };
  }

  /** Reset code + new password → password set and signed in. */
  async resetPassword(email, code, newPassword) {
    checkPassword(newPassword);
    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user) throw new HttpError(400, "This code has expired. Please ask for a new one.", "CODE_EXPIRED");
    refuseInactive(user);

    await emailCodeService.verify(user.email, "reset_password", code);

    user.password = await bcrypt.hash(newPassword, 10);
    // The code proves they own the email.
    if (user.emailVerified === false) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    user.lastLoginAt = new Date();
    await user.save();
    return signedIn(user);
  }

  /** SMS code proved + new password → password set and signed in (phone accounts). */
  async resetPasswordWithPhone({ password, ...proof }) {
    checkPassword(password);
    const phone = await provePhone(proof);
    const user = await User.findOne({ phone, phoneVerified: true });
    if (!user) {
      throw new HttpError(404, "No account found for this mobile number. Create one instead.", "ACCOUNT_NOT_FOUND");
    }
    refuseInactive(user);
    user.password = await bcrypt.hash(password, 10);
    user.lastLoginAt = new Date();
    await user.save();
    return signedIn(user);
  }

  // ----------------------------
  // Continue with Google (no password; Google proves the email)
  // ----------------------------
  async googleLogin(credential) {
    const google = await verifyGoogleCredential(credential);

    let user = await User.findOne({ googleId: google.googleId }).select("+password +googleId");
    if (!user) user = await User.findOne({ email: google.email }).select("+password +googleId");
    const isNew = !user;

    if (!user) {
      user = await User.create({
        email: google.email,
        firstName: google.firstName,
        lastName: google.lastName,
        avatarUrl: google.avatarUrl,
        googleId: google.googleId,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      });
    } else {
      refuseInactive(user);
      // Same email as an existing account: link Google to it.
      user.googleId = google.googleId;
      if (!user.firstName && google.firstName) user.firstName = google.firstName;
      if (!user.lastName && google.lastName) user.lastName = google.lastName;
      if (!user.avatarUrl && google.avatarUrl) user.avatarUrl = google.avatarUrl;
      if (user.emailVerified === false) {
        user.emailVerified = true;
        user.emailVerifiedAt = new Date();
      }
    }
    user.lastLoginAt = new Date();
    await user.save();

    return signedIn(user, { isNew });
  }

  // ----------------------------
  // Logged-in customer
  // ----------------------------
  async getProfile(userId) {
    const user = await User.findById(userId).select("+password +googleId");
    if (!user) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");

    return {
      ...publicUser(user),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      birthday: serializeBirthday(user.birthday),
    };
  }

  /**
   * Name, phone (only when it isn't the sign-in number) and birthday.
   * The sign-in email / number can't be changed here.
   */
  async updateProfile(userId, profileData) {
    const { firstName, lastName, phone } = profileData;

    const user = await User.findById(userId).select("+password +googleId");
    if (!user) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");

    if (firstName !== undefined) {
      const trimmed = String(firstName).trim();
      if (!trimmed) throw new HttpError(400, "First name can't be empty.", "NAME_REQUIRED");
      user.firstName = trimmed.slice(0, 60);
    }
    if (lastName !== undefined) user.lastName = String(lastName).trim().slice(0, 60);

    if (phone !== undefined && phone !== user.phone) {
      if (user.phoneVerified) {
        throw new HttpError(400, "Your mobile number is how you sign in, so it can't be changed here.", "LOGIN_PHONE_LOCKED");
      }
      const normalized = phone === "" ? "" : phoneAuth.normalizeIndianPhone(phone);
      if (normalized === null) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.", "INVALID_PHONE");
      user.phone = normalized;
    }

    if (profileData.birthday !== undefined) {
      user.birthday = parseBirthday(profileData.birthday);
    }
    await user.save();

    return { ...publicUser(user), birthday: serializeBirthday(user.birthday) };
  }

  /**
   * Change the password (needs the current one), or set the first one for
   * accounts made without a password (Google, or older code-only accounts).
   */
  async changePassword(userId, { currentPassword, newPassword, confirmPassword }) {
    checkPassword(newPassword);
    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      throw new HttpError(400, "The two passwords don't match.", "PASSWORD_MISMATCH");
    }

    const user = await User.findById(userId).select("+password");
    if (!user) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");

    if (user.password) {
      if (!currentPassword) throw new HttpError(400, "Enter your current password.", "PASSWORD_REQUIRED");
      if (!(await bcrypt.compare(currentPassword, user.password))) {
        throw new HttpError(400, "Current password is incorrect.", "WRONG_PASSWORD");
      }
      if (await bcrypt.compare(newPassword, user.password)) {
        throw new HttpError(400, "The new password must be different from the current one.", "SAME_PASSWORD");
      }
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return { hasPassword: true };
  }
}

const service = new AuthService();
// For tests.
service.parseIdentifier = parseIdentifier;
module.exports = service;
