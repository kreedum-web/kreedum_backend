const mongoose = require("mongoose");

/**
 * One search typed on the website (page 1, before any filter), for the
 * admin's Search page: what customers look for, and what finds nothing.
 * No customer details are kept. Deleted after 180 days.
 */
const searchLogSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, maxlength: 100 }, // lowercase, tidied: "aerofit treadmill"
    text: { type: String, default: "", maxlength: 100 }, // as typed
    results: { type: Number, default: 0 },
    relaxed: { type: Boolean, default: false }, // no product matched every word
    at: { type: Date, default: Date.now },
  },
  { collection: "search_logs", versionKey: false }
);

searchLogSchema.index({ at: -1 });
searchLogSchema.index({ term: 1, at: -1 });
searchLogSchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model("SearchLog", searchLogSchema);
