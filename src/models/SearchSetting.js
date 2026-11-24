const mongoose = require("mongoose");

/**
 * Search settings from the admin (one document, key "search"):
 *   pinned  popular searches always shown first, in order
 *   hidden  searches never shown as popular (typos, odd ones)
 */
const searchSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "search", unique: true },
    pinned: { type: [String], default: [] },
    hidden: { type: [String], default: [] },
  },
  { timestamps: true, collection: "search_settings" }
);

module.exports = mongoose.model("SearchSetting", searchSettingSchema);
