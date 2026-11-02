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

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
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

userSchema.index(
  { email: 1 },
  { unique: true, name: "user_email_unique" }
);
userSchema.index(
  { googleId: 1 },
  { unique: true, sparse: true, name: "user_google_id_unique" }
);

module.exports = mongoose.model("User", userSchema);