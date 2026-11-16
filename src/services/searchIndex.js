const Product = require("../models/Product");
const Category = require("../models/Category");
const { termsOf, parseQuery, wordMatch } = require("../utils/searchText");

/**
 * The website's product search, kept in memory (about 1,300 products, so
 * this is fast and needs no special database index).
 *
 * - every typed word must match something about the product (name, brand,
 *   model number, category or keywords), in any order and any capitals
 * - "tread" finds treadmills; small typos are forgiven ("traedmill") when the
 *   word isn't in the catalogue as typed
 * - price phrases are understood: "under 1 lakh", "10k to 20k", "above 50000"
 * - nothing matches every word → the closest matches, marked relaxed
 *
 * The list is refreshed from the database every few minutes, so new or
 * changed products show up in search without a restart.
 */
const REFRESH_MS = 5 * 60 * 1000;

// How much a match in each part of the product counts.
const FIELD_WEIGHT = { name: 3, sku: 3, brand: 3, category: 2, keywords: 1 };

const INDEX_FIELDS = {
  name: 1, slug: 1, sku: 1, brand: 1, brandSlug: 1, thumbnail: 1, sellingPrice: 1, mrp: 1,
  discountPercent: 1, department: 1, parentCategory: 1, childCategory: 1, categoryPath: 1,
  searchKeywords: 1, isFeatured: 1, isBestSeller: 1, displayOrder: 1, createdAt: 1,
};

/** One product as the search sees it. */
function indexProduct(product, categoryNames = new Map()) {
  const fields = {
    name: termsOf(product.name),
    sku: termsOf(product.sku),
    brand: termsOf(product.brand),
    category: (product.categoryPath || []).flatMap((slug) => termsOf(categoryNames.get(slug) || slug.replace(/-/g, " "))),
    keywords: (product.searchKeywords || []).flatMap(termsOf),
  };
  // Each word → its best field weight.
  const terms = new Map();
  for (const [field, words] of Object.entries(fields)) {
    for (const word of words) terms.set(word, Math.max(terms.get(word) || 0, FIELD_WEIGHT[field]));
  }
  return { product, terms, nameText: termsOf(product.name).join(" ") };
}

/** All products → a searchable list, plus every word we know (for typo matching). */
function buildIndex(products, categoryNames = new Map()) {
  const items = products.map((product) => indexProduct(product, categoryNames));
  const vocabulary = new Map(); // word → how many products have it
  for (const item of items) for (const word of item.terms.keys()) vocabulary.set(word, (vocabulary.get(word) || 0) + 1);
  return { items, vocabulary, builtAt: Date.now() };
}

/**
 * For each typed word: which catalogue words count as a match, and how well.
 * Typos are only used when the word has no exact / starts-with match, so
 * "glove" never also matches "globe".
 */
function expandWords(words, vocabulary) {
  return words.map((forms) => {
    const matches = new Map();
    let corrected = null;
    for (const [term, count] of vocabulary) {
      let best = 0;
      for (const form of forms) best = Math.max(best, wordMatch(form, term));
      if (best >= 1.5) matches.set(term, best);
      else if (best === 1 && (!corrected || count > corrected.count)) corrected = { term, count, quality: best };
    }
    if (!matches.size) {
      // Nothing as typed: allow typos (all of them, best known word as the suggestion).
      for (const [term] of vocabulary) {
        let best = 0;
        for (const form of forms) best = Math.max(best, wordMatch(form, term));
        if (best === 1) matches.set(term, best);
      }
      return { forms, matches, correction: matches.size && corrected ? corrected.term : null };
    }
    return { forms, matches, correction: null };
  });
}

const sorters = {
  relevance: (a, b) => b.score - a.score || (b.product.isBestSeller === true) - (a.product.isBestSeller === true),
  price_low_high: (a, b) => (a.product.sellingPrice || Infinity) - (b.product.sellingPrice || Infinity),
  price_high_low: (a, b) => (b.product.sellingPrice || 0) - (a.product.sellingPrice || 0),
  discount: (a, b) => (b.product.discountPercent || 0) - (a.product.discountPercent || 0),
  newest: (a, b) => new Date(b.product.createdAt || 0) - new Date(a.product.createdAt || 0),
  featured: (a, b) => (b.product.isFeatured === true) - (a.product.isFeatured === true) || (a.product.displayOrder || 0) - (b.product.displayOrder || 0),
  popular: (a, b) => (b.product.isBestSeller === true) - (a.product.isBestSeller === true) || b.score - a.score,
};

/**
 * Search the index.
 * @param filters { brand, department, category, minPrice, maxPrice, sort }
 * @returns {{ results: {product, score}[], minPrice?, maxPrice?, words: string[], corrections: {from,to}[], relaxed: boolean }}
 */
function searchIndex(index, query, filters = {}) {
  const parsed = parseQuery(query);
  const minPrice = filters.minPrice !== undefined && filters.minPrice !== "" ? Number(filters.minPrice) : parsed.minPrice;
  const maxPrice = filters.maxPrice !== undefined && filters.maxPrice !== "" ? Number(filters.maxPrice) : parsed.maxPrice;
  const priced = minPrice !== undefined || maxPrice !== undefined;

  const candidates = index.items.filter(({ product: p }) => {
    if (filters.brand && p.brandSlug !== filters.brand && String(p.brand).toLowerCase() !== String(filters.brand).toLowerCase()) return false;
    if (filters.department && p.department !== filters.department) return false;
    if (filters.category && !(p.categoryPath || []).includes(filters.category) && p.parentCategory !== filters.category && p.childCategory !== filters.category) return false;
    if (priced) {
      const price = Number(p.sellingPrice) || 0;
      if (!price) return false; // price on request: not in a price search
      if (minPrice !== undefined && price < minPrice) return false;
      if (maxPrice !== undefined && price > maxPrice) return false;
    }
    return true;
  });

  const words = expandWords(parsed.words, index.vocabulary);
  const corrections = words
    .filter((w) => w.correction && w.correction !== w.forms[0])
    .map((w) => ({ from: w.forms[0], to: w.correction }));

  // Nothing to match on (e.g. only "under 50000"): every candidate, by price.
  if (!words.length) {
    const results = candidates.map(({ product }) => ({ product, score: 0 }));
    results.sort(sorters[filters.sort] || (priced ? sorters.price_low_high : sorters.featured));
    return { results, minPrice, maxPrice, words: [], corrections, relaxed: false };
  }

  const phrase = parsed.words.map((forms) => forms[0]).join(" ");
  const scored = [];
  for (const item of candidates) {
    let score = 0;
    let matched = 0;
    for (const word of words) {
      let best = 0;
      for (const [term, weight] of item.terms) {
        const quality = word.matches.get(term);
        if (quality) best = Math.max(best, quality * weight);
      }
      if (best) matched++;
      score += best;
    }
    if (!matched) continue;
    if (item.nameText.includes(phrase)) score += 5; // the words together, in order, in the name
    scored.push({ product: item.product, score, matched });
  }

  let results = scored.filter((r) => r.matched === words.length);
  let relaxed = false;
  if (!results.length && words.length > 1) {
    // Closest matches: as many words as possible (at least half).
    const most = Math.max(...scored.map((r) => r.matched), 0);
    if (most >= Math.ceil(words.length / 2)) {
      results = scored.filter((r) => r.matched === most);
      relaxed = true;
    }
  }

  results.sort(sorters[filters.sort] || sorters.relevance);
  return { results, minPrice, maxPrice, words: parsed.words.map((forms) => forms[0]), corrections, relaxed };
}

// ------------------------------------------------------------------ live index

let current = null;
let loading = null;

async function loadIndex() {
  const [products, categories] = await Promise.all([
    Product.find({ visibility: "published", isActive: true }, INDEX_FIELDS).lean(),
    Category.find({}, { slug: 1, name: 1 }).lean(),
  ]);
  return buildIndex(products, new Map(categories.map((c) => [c.slug, c.name])));
}

/** The current index; rebuilt from the database when older than a few minutes. */
async function getIndex() {
  const fresh = current && Date.now() - current.builtAt < REFRESH_MS;
  if (fresh) return current;
  if (!loading) {
    loading = loadIndex()
      .then((index) => (current = index))
      .finally(() => {
        loading = null;
      });
  }
  // A slightly old index is fine while the new one loads.
  return current && !fresh ? current : loading;
}

/** Forget the index (e.g. after a catalogue change); the next search rebuilds it. */
function resetIndex() {
  current = null;
}

module.exports = { buildIndex, searchIndex, getIndex, resetIndex, indexProduct };
