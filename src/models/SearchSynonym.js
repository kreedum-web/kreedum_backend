const mongoose = require("mongoose");

/**
 * Words or phrases that mean the same in search, set in the admin:
 * e.g. ["walking pad", "walkpad", "walk pad"]. Typing any one finds products
 * that use any of them.
 */
const searchSynonymSchema = new mongoose.Schema(
  {
    phrases: { type: [String], required: true },
  },
  { timestamps: true, collection: "search_synonyms" }
);

module.exports = mongoose.model("SearchSynonym", searchSynonymSchema);
