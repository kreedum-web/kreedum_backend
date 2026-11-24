const mongoose = require("mongoose");
const SearchSynonym = require("../../models/SearchSynonym");
const SearchSetting = require("../../models/SearchSetting");
const HttpError = require("../../utils/httpError");
const { normalize } = require("../../utils/searchText");
const { getIndex, searchIndex, resetIndex } = require("../searchIndex");
const { searchStats, popularSearches, clearPopularCache, settings } = require("../searchInsights");

/**
 * Admin: the Search page. What customers search (and what finds nothing),
 * spellings that mean the same ("walking pad" = "walkpad"), and the
 * website's popular searches.
 */

/** ["Walking Pad", " walkpad ", "walking pad"] → ["walking pad", "walkpad"] (checked) */
function cleanPhrases(phrases) {
  if (!Array.isArray(phrases)) throw new HttpError(400, "Send the words as a list.");
  const seen = new Set();
  const out = [];
  for (const raw of phrases) {
    const phrase = normalize(raw);
    if (!phrase) continue;
    if (phrase.length > 40) throw new HttpError(400, `"${String(raw).slice(0, 40)}…" is too long (max 40 characters).`);
    if (phrase.split(" ").length > 4) throw new HttpError(400, `"${raw}": use at most 4 words.`);
    if (!seen.has(phrase)) {
      seen.add(phrase);
      out.push(phrase);
    }
  }
  if (out.length < 2) throw new HttpError(400, "Give at least two words or phrases that mean the same.");
  if (out.length > 10) throw new HttpError(400, "At most 10 in one group.");
  return out;
}

const groupItem = (g) => ({ id: String(g._id), phrases: g.phrases, updatedAt: g.updatedAt });

class AdminSearchService {
  stats({ days = 30 } = {}) {
    const d = Math.min(180, Math.max(1, Number(days) || 30));
    return searchStats({ days: d });
  }

  /** Try a search as customers would: the first products and what was understood. */
  async test(q = "") {
    const text = String(q).trim().slice(0, 100);
    if (!text) return { total: 0, products: [], interpreted: null };
    const found = searchIndex(await getIndex(), text);
    return {
      total: found.results.length,
      products: found.results.slice(0, 12).map(({ product }) => ({
        id: String(product._id),
        name: product.name,
        slug: product.slug,
        brand: product.brand,
        thumbnail: product.thumbnail || "",
        sellingPrice: product.sellingPrice,
      })),
      interpreted: { corrections: found.corrections, relaxed: found.relaxed, minPrice: found.minPrice ?? null, maxPrice: found.maxPrice ?? null },
    };
  }

  // ---------------------------------------------------------------- spellings

  async synonyms() {
    return (await SearchSynonym.find({}).sort({ updatedAt: -1 }).lean()).map(groupItem);
  }

  async #checkOverlap(phrases, exceptId = null) {
    const clash = await SearchSynonym.findOne({ phrases: { $in: phrases }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
    if (clash) {
      const word = phrases.find((p) => clash.phrases.includes(p));
      throw new HttpError(409, `"${word}" is already in the group "${clash.phrases.join(" = ")}". Add the words there instead.`);
    }
  }

  async createSynonym({ phrases } = {}) {
    const clean = cleanPhrases(phrases);
    await this.#checkOverlap(clean);
    const group = await SearchSynonym.create({ phrases: clean });
    resetIndex(); // the next search uses it
    return groupItem(group);
  }

  async updateSynonym(id, { phrases } = {}) {
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Invalid id.");
    const clean = cleanPhrases(phrases);
    await this.#checkOverlap(clean, id);
    const group = await SearchSynonym.findByIdAndUpdate(id, { $set: { phrases: clean } }, { new: true }).lean();
    if (!group) throw new HttpError(404, "Not found.");
    resetIndex();
    return groupItem(group);
  }

  async deleteSynonym(id) {
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Invalid id.");
    await SearchSynonym.deleteOne({ _id: id });
    resetIndex();
    return { deleted: true };
  }

  // ---------------------------------------------------------------- popular searches

  /** Pinned and hidden searches, and the list the website shows now. */
  async popular() {
    const { pinned = [], hidden = [] } = await settings();
    return { pinned, hidden, showing: await popularSearches() };
  }

  /** { pinned?: [...], hidden?: [...] } */
  async updatePopular(body = {}) {
    const list = (value, label) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value)) throw new HttpError(400, `${label}: send a list.`);
      const out = [...new Set(value.map((v) => String(v).trim().replace(/\s+/g, " ")).filter(Boolean))];
      if (out.some((v) => v.length > 60)) throw new HttpError(400, `${label}: keep each under 60 characters.`);
      return out.slice(0, 50);
    };
    const $set = {};
    const pinned = list(body.pinned, "Pinned searches");
    const hidden = list(body.hidden, "Hidden searches");
    if (pinned) $set.pinned = pinned;
    if (hidden) $set.hidden = hidden;
    await SearchSetting.updateOne({ key: "search" }, { $set }, { upsert: true });
    clearPopularCache();
    return this.popular();
  }
}

module.exports = new AdminSearchService();
