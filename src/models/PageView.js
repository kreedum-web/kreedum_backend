const mongoose = require("mongoose");

/**
 * One page opened on the store (sent by the website, POST /api/v1/track).
 * Feeds the dashboard's Traffic page. Kept for 400 days, then MongoDB
 * deletes it by itself (TTL index), so the collection never grows forever.
 */
const pageViewSchema = new mongoose.Schema(
  {
    // Random id the browser keeps (localStorage): one visitor across visits.
    visitorId: { type: String, required: true, maxlength: 64 },
    path: { type: String, required: true, maxlength: 300 },
    // Site the visitor came from ("google.com"), "" for direct / internal.
    referrer: { type: String, default: "", maxlength: 120 },
    device: { type: String, enum: ["mobile", "tablet", "desktop"], default: "desktop" },
    signedIn: { type: Boolean, default: false },
    // India day of the visit, "2026-11-18", for daily counts.
    day: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { collection: "page_views", versionKey: false }
);

pageViewSchema.index({ at: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });
pageViewSchema.index({ day: 1, visitorId: 1 });

module.exports = mongoose.model("PageView", pageViewSchema);
