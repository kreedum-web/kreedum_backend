const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { generateToken } = require("../utils/jwt");
const HttpError = require("../utils/httpError");
const emailCodeService = require("./emailCodeService");
const { CODE_MINUTES } = require("./emailCodeService");
const { sendMail } = require("../utils/mailer");
const { loginCodeEmail, verificationCodeEmail, passwordResetCodeEmail } = require("../emails/templates");
const { verifyGoogleCredential } = require("../utils/googleAuth");

const MIN_PASSWORD = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();

function publicUser(user) {
  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    avatarUrl: user.avatarUrl || "",
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

/** Send a sign-up code. Mail errors become a message the customer can act on. */
async function sendVerificationCode(user) {
  const code = await emailCodeService.issue(user.email, "verify_email");
  try {
    await sendMail({ to: user.email, ...verificationCodeEmail({ name: user.firstName, code, minutes: CODE_MINUTES }) });
  } catch (error) {
    console.error("Verification email failed:", error.message);
    throw new HttpError(502, "We couldn't send the code email right now. Please try again in a minute.", "EMAIL_SEND_FAILED");
  }
}

// Accept strict date-only ISO strings to avoid ambiguous date parsing.

function parseBirthday(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  // Expected format: YYYY-MM-DD
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new Error(
      "Birthday must be a valid date in YYYY-MM-DD format."
    );
  }

  const [year, month, day] = value.split("-").map(Number);

  // Validate the actual calendar date (e.g. reject 1998-02-31).
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Birthday is not a valid calendar date.");
  }

  // Reject birthdays in the future.
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  if (date.getTime() > todayUtc) {
    throw new Error("Birthday cannot be in the future.");
  }

  return date;
}


function serializeBirthday(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

class AuthService {

  // ----------------------------
  // Sign in or create an account with an emailed code (no password)
  // ----------------------------
  async startEmailLogin(email) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
    }

    const user = await User.findOne({ email: normalized });
    if (user) refuseInactive(user);

    const code = await emailCodeService.issue(normalized, "login");
    try {
      await sendMail({ to: normalized, ...loginCodeEmail({ name: user?.firstName, code, minutes: CODE_MINUTES }) });
    } catch (error) {
      console.error("Sign-in code email failed:", error.message);
      throw new HttpError(502, "We couldn't send the code email right now. Please try again in a minute.", "EMAIL_SEND_FAILED");
    }
    return { sent: true, email: normalized };
  }

  /** The code is right: log in, creating the account the first time. */
  async verifyEmailLogin(email, code) {
    const normalized = normalizeEmail(email);
    await emailCodeService.verify(normalized, "login", code);

    let user = await User.findOne({ email: normalized });
    const isNew = !user;
    if (!user) {
      user = await User.create({ email: normalized, emailVerified: true, emailVerifiedAt: new Date() });
    } else {
      refuseInactive(user);
      // The code proves they own the email (also finishes an old unfinished sign-up).
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
  // Continue with Google
  // ----------------------------
  async googleLogin(credential) {
    const google = await verifyGoogleCredential(credential);

    let user = await User.findOne({ googleId: google.googleId });
    if (!user) user = await User.findOne({ email: google.email });
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
  // Register Customer
  // ----------------------------
  async register(userData) {
    const { firstName, lastName, email, phone, password, birthday  } = userData;

     // Required field validation
  if (!firstName || !email || !password) {
    throw new Error("First name, email and password are required.");
  }

  const emailRegex =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!emailRegex.test(email.toLowerCase())) {
  throw new Error("Invalid email format.");
}

  // Password should not be empty spaces
  if (password.trim().length === 0) {
    throw new Error("Password cannot be empty.");
  }

if (password.length < 8) {
  throw new Error(
    "Password must be at least 8 characters long."
  );
}

const parsedBirthday = parseBirthday(birthday);


    const existingUser = await User.findOne({
      email: email.toLowerCase(),
    });

    // Signed up before but never entered the code: start over with the new details.
    if (existingUser && existingUser.emailVerified !== false) {
      throw new Error("Email already registered.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const details = {
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      birthday: parsedBirthday,
      password: hashedPassword,
      emailVerified: false,
    };

    let user;
    if (existingUser) {
      Object.assign(existingUser, details);
      user = await existingUser.save();
    } else {
      user = await User.create(details);
    }

    // The account is usable once the emailed code is entered (verifyEmail).
    await sendVerificationCode(user);

    return { requiresVerification: true, email: user.email };
  }

  // ----------------------------
  // Confirm email with the code (logs the customer in)
  // ----------------------------
  async verifyEmail(email, code) {
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) throw new HttpError(400, "This code has expired. Please ask for a new one.", "CODE_EXPIRED");
    if (user.emailVerified !== false) {
      throw new HttpError(409, "This email is already verified. Please log in.", "ALREADY_VERIFIED");
    }

    await emailCodeService.verify(user.email, "verify_email", code);

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.lastLoginAt = new Date();
    await user.save();

    return { user: publicUser(user), token: generateToken(user) };
  }

  // ----------------------------
  // New sign-up code
  // ----------------------------
  async resendVerificationCode(email) {
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    // Same answer whether or not the account exists.
    if (!user || user.emailVerified !== false) return { sent: true };
    await sendVerificationCode(user);
    return { sent: true };
  }

  // ----------------------------
  // Forgot password: email a reset code
  // ----------------------------
  async forgotPassword(email) {
    const normalized = String(email || "").toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
    }

    const user = await User.findOne({ email: normalized });
    // Same answer whether or not the account exists, so emails can't be probed.
    if (!user || user.isActive === false) return { sent: true };

    const code = await emailCodeService.issue(user.email, "reset_password");
    try {
      await sendMail({ to: user.email, ...passwordResetCodeEmail({ name: user.firstName, code, minutes: CODE_MINUTES }) });
    } catch (error) {
      console.error("Password reset email failed:", error.message);
      throw new HttpError(502, "We couldn't send the code email right now. Please try again in a minute.", "EMAIL_SEND_FAILED");
    }
    return { sent: true };
  }

  // ----------------------------
  // Reset password with the code (logs the customer in)
  // ----------------------------
  async resetPassword(email, code, newPassword) {
    if (!newPassword || newPassword.trim().length === 0 || newPassword.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters long.`, "WEAK_PASSWORD");
    }

    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) throw new HttpError(400, "This code has expired. Please ask for a new one.", "CODE_EXPIRED");

    await emailCodeService.verify(user.email, "reset_password", code);

    user.password = await bcrypt.hash(newPassword, 10);
    // The code proves they own the email.
    if (user.emailVerified === false) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    user.lastLoginAt = new Date();
    await user.save();

    return { user: publicUser(user), token: generateToken(user) };
  }

  // ----------------------------
  // Login Customer
  // ----------------------------
  async login(email, password) {
    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!user) {
      throw new Error("Invalid email or password.");
    }

    // Made with an email code or Google: there is no password to check.
    if (!user.password) {
      throw new HttpError(
        400,
        "This account doesn't use a password. Sign in with an email code or Google instead.",
        "NO_PASSWORD",
        { email: user.email }
      );
    }

    const passwordMatched = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatched) {
      throw new Error("Invalid email or password.");
    }

    // Signed up but never entered the code: send a fresh one and ask for it.
    if (user.emailVerified === false) {
      try {
        await sendVerificationCode(user);
      } catch (error) {
        // A code sent less than a minute ago still works.
        if (error.code !== "CODE_COOLDOWN") throw error;
      }
      throw new HttpError(403, "Please verify your email first. We've sent a code to your inbox.", "EMAIL_NOT_VERIFIED", {
        email: user.email,
      });
    }

    refuseInactive(user);
    user.lastLoginAt = new Date();
    await user.save();

    return signedIn(user);
  }

  // ----------------------------
  // Get Logged-in User
  // ----------------------------
  async getProfile(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found.");
    }

    return {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatarUrl: user.avatarUrl || "",
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      birthday: serializeBirthday(user.birthday),
    };
  }

  // ----------------------------
  // Update Customer Profile
  // ----------------------------
  async updateProfile(userId, profileData) {
    const { firstName, lastName, phone } = profileData;

    const user = await User.findById(userId);

    if (!user) {
      throw new Error("User not found.");
    }

    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
if (profileData.birthday !== undefined) {
  user.birthday = parseBirthday(profileData.birthday);
}
    await user.save();

    return {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      birthday: serializeBirthday(user.birthday),
    };
  }
}

module.exports = new AuthService();