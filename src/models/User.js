const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // Empty until the customer gives a name (Google sign-in fills it, otherwise
    // the first checkout address does). The site shows the email until then.
    firstName: {
      type: String,
      default: "",
      trim: true,
    },

    lastName: {
      type: String,
      default: "",
      trim: true,
    },

    // Missing for accounts made with a phone number only.
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },

    // 10 digits, e.g. "9876543210". The sign-in number when phoneVerified is
    // true (can't be changed then); otherwise just a contact number.
    phone: {
      type: String,
      default: "",
      trim: true,
    },

    // true once the customer signed in with an OTP sent to this phone.
    phoneVerified: {
      type: Boolean,
    },

    phoneVerifiedAt: {
      type: Date,
    },

    birthday: {
  type: Date,
  default: null,
    },

    // Only for accounts that chose a password. Accounts made with an email
    // code or Google have none.
    password: {
      type: String,
      select: false,
    },

    // Google account id ("sub") once the customer has used "Continue with Google".
    googleId: {
      type: String,
      select: false,
    },

    avatarUrl: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: {
      type: Date,
    },

    // false: signed up but hasn't entered the emailed code yet (can't log in).
    // Deliberately no default: accounts created before email codes existed
    // have no value and count as verified.
    emailVerified: {
      type: Boolean,
    },

    emailVerifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// One account per email, and per verified phone. Accounts without an email
// (phone sign-in) aren't counted, which a plain unique index would do.
// src/utils/ensureUserIndexes.js replaces the older email index.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } }, name: "user_email_unique_v2" }
);

userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phoneVerified: true }, name: "user_verified_phone_unique" }
);
userSchema.index(
  { googleId: 1 },
  { unique: true, sparse: true, name: "user_google_id_unique" }
);

module.exports = mongoose.model("User", userSchema);