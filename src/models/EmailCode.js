const mongoose = require("mongoose");

/**
 * A one-time code emailed to a customer (sign-in, sign-up verification,
 * password reset). Only a hash of the code is stored. MongoDB deletes expired codes
 * by itself (TTL index on expiresAt).
 */
const emailCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: ["verify_email", "reset_password", "login"], required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    // How many codes were sent in the current hour, to stop email flooding.
    sendCount: { type: Number, default: 0 },
    windowStart: { type: Date, default: Date.now },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "email_codes" }
);

emailCodeSchema.index({ email: 1, purpose: 1 }, { unique: true });
// Kept an hour after expiry, so the hourly send limit still counts.
emailCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model("EmailCode", emailCodeSchema);
