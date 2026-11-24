const Product = require("../models/Product");
const Category = require("../models/Category");
const { termsOf, parseQuery, wordMatch, prepareGroups, groupTermsOf } = require("../utils/searchText");
const SearchSynonym = require("../models/SearchSynonym");
const { brandList, facetsOf, priceOf } = require("../utils/productFacets");

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
// Description and feature lines count little: they only add matches that
// rank below products whose name / category say it.
const FIELD_WEIGHT = { name: 3, sku: 3, brand: 3, category: 2, keywords: 1, details: 0.5 };

const INDEX_FIELDS = {
  name: 1, slug: 1, sku: 1, brand: 1, brandSlug: 1, thumbnail: 1, sellingPrice: 1, mrp: 1,
  discountPercent: 1, department: 1, parentCategory: 1, childCategory: 1, categoryPath: 1,
  searchKeywords: 1, isFeatured: 1, isBestSeller: 1, displayOrder: 1, createdAt: 1,
  descriptionText: 1, features: 1,
};

/** One product as the search sees it. */
function indexProduct(product, categoryNames = new Map(), groups = [], popularity = 0) {
  const categoryText = (product.categoryPath || []).map((slug) => categoryNames.get(slug) || slug.replace(/-/g, " "));
  const detailsText = [product.descriptionText || "", ...(product.features || [])].join(" ").slice(0, 4000);
  const texts = {
    name: [product.name],
    sku: [product.sku],
    brand: [product.brand],
    category: categoryText,
    keywords: product.searchKeywords || [],
    details: [detailsText],
  };
  // Each word → its best field weight (and the admin's spelling groups it contains).
  const terms = new Map();
  for (const [field, list] of Object.entries(texts)) {
    for (const text of list) {
      for (const word of [...termsOf(text), ...groupTermsOf(text, groups)]) {
        terms.set(word, Math.max(terms.get(word) || 0, FIELD_WEIGHT[field]));
      }
    }
  }
  return { product, terms, nameText: termsOf(product.name).join(" "), popularity };
}

/**
 * All products → a searchable list, plus every word we know (for typo matching).
 * groups: the admin's spellings; popularity: Map slug → score (views, orders, enquiries).
 */
function buildIndex(products, categoryNames = new Map(), { groups = [], popularity = new Map() } = {}) {
  const prepared = prepareGroups(groups);
  const items = products.map((product) => indexProduct(product, categoryNames, prepared, popularity.get(product.slug) || 0));
  // word → how many products have it; typoWords: only words from names, brands,
  // categories and keywords (a typo is never "corrected" to a description word)
  const vocabulary = new Map();
  const typoWords = new Set();
  for (const item of items) {
    for (const [word, weight] of item.terms) {
      vocabulary.set(word, (vocabulary.get(word) || 0) + 1);
      if (weight >= 1 && !word.startsWith("syn:")) typoWords.add(word);
    }
  }
  return { items, vocabulary, typoWords, groups: prepared, builtAt: Date.now() };
}

/**
 * For each typed word: which catalogue words count as a match, and how well.
 * Typos are only used when the word has no exact / starts-with match, so
 * "glove" never also matches "globe".
 */
function expandWords(words, vocabulary, typoWords = null) {
  return words.map((forms) => {
    const matches = new Map();
    // A spelling group's word matches only itself.
    if (forms.length === 1 && forms[0].startsWith("syn:")) {
      if (vocabulary.has(forms[0])) matches.set(forms[0], 3);
      return { forms, matches, correction: null };
    }
    let corrected = null;
    for (const [term, count] of vocabulary) {
      if (typoWords && !typoWords.has(term) && wordMatch(forms[0], term) === 1) continue;
      let best = 0;
      for (const form of forms) best = Math.max(best, wordMatch(form, term));
      if (best >= 1.5) matches.set(term, best);
      else if (best === 1 && (!corrected || count > corrected.count)) corrected = { term, count, quality: best };
    }
    if (!matches.size) {
      // Nothing as typed: allow typos (all of them, best known word as the suggestion).
      for (const [term] of vocabulary) {
        if (typoWords && !typoWords.has(term)) continue;
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
  // score includes a small boost for products customers view, order and ask about
  relevance: (a, b) => b.score - a.score || b.popularity - a.popularity || (b.product.isBestSeller === true) - (a.product.isBestSeller === true),
  price_low_high: (a, b) => (a.product.sellingPrice || Infinity) - (b.product.sellingPrice || Infinity),
  price_high_low: (a, b) => (b.product.sellingPrice || 0) - (a.product.sellingPrice || 0),
  discount: (a, b) => (b.product.discountPercent || 0) - (a.product.discountPercent || 0),
  newest: (a, b) => new Date(b.product.createdAt || 0) - new Date(a.product.createdAt || 0),
  featured: (a, b) => (b.product.isFeatured === true) - (a.product.isFeatured === true) || (a.product.displayOrder || 0) - (b.product.displayOrder || 0),
  popular: (a, b) => b.popularity - a.popularity || (b.product.isBestSeller === true) - (a.product.isBestSeller === true) || b.score - a.score,
};

/**
 * Search the index.
 * @param filters { brand (one, "a,b" or an array), department, category, minPrice, maxPrice, sort }
 * @returns { results, facets, minPrice, maxPrice, words, corrections, relaxed }
 *   facets: brands (with counts) and price range of what the words matched,
 *   for the filter panel (see productFacets.js).
 */
function searchIndex(index, query, filters = {}) {
  const parsed = parseQuery(query, index.groups || []);
  const minPrice = priceOf(filters.minPrice) ?? parsed.minPrice;
  const maxPrice = priceOf(filters.maxPrice) ?? parsed.maxPrice;
  const priced = minPrice !== undefined || maxPrice !== undefined;
  const brands = brandList(filters.brand);

  // Department / category narrow what's searched; brand and price are
  // applied last, so the filter panel can still offer the other options.
  const candidates = index.items.filter(({ product: p }) => {
    if (filters.department && p.department !== filters.department) return false;
    if (filters.category && !(p.categoryPath || []).includes(filters.category) && p.parentCategory !== filters.category && p.childCategory !== filters.category) return false;
    return true;
  });
  const chosen = ({ product: p }) => {
    if (brands.length && !brands.includes(p.brandSlug) && !brands.includes(String(p.brand).toLowerCase())) return false;
    if (priced) {
      const price = Number(p.sellingPrice) || 0;
      if (!price) return false; // price on request: not in a price search
      if (minPrice !== undefined && price < minPrice) return false;
      if (maxPrice !== undefined && price > maxPrice) return false;
    }
    return true;
  };
  const finish = (matched, extra) => {
    const facets = facetsOf(matched.map((r) => r.product), { brands, minPrice, maxPrice });
    return { results: matched.filter(chosen), facets, minPrice, maxPrice, ...extra };
  };

  const words = expandWords(parsed.words, index.vocabulary, index.typoWords);
  const corrections = words
    .filter((w) => w.correction && w.correction !== w.forms[0])
    .map((w) => ({ from: w.forms[0], to: w.correction }));

  // Nothing to match on (e.g. only "under 50000"): every candidate, by price.
  if (!words.length) {
    const results = candidates.map(({ product, popularity }) => ({ product, score: 0, popularity }));
    results.sort(sorters[filters.sort] || (priced ? sorters.price_low_high : sorters.featured));
    return finish(results, { words: [], corrections, relaxed: false });
  }

  const phrase = parsed.words.map((forms) => forms[0]).join(" ");
  const scored = [];
  for (const item of candidates) {
    let score = 0;
    let matched = 0;
    for (const word of words) {
      let best = 0;
      // the word's few matching catalogue words, looked up in this product
      for (const [term, quality] of word.matches) {
        const weight = item.terms.get(term);
        if (weight) best = Math.max(best, quality * weight);
      }
      if (best) matched++;
      score += best;
    }
    if (!matched) continue;
    if (item.nameText.includes(phrase)) score += 5; // the words together, in order, in the name
    // Popular products (views, orders, enquiries) rise a little among equal matches:
    // at most +1, less than one word matching better.
    score += Math.min(1, Math.log10(1 + item.popularity) / 2);
    scored.push({ product: item.product, score, matched, popularity: item.popularity });
  }

  // Every word must match; else the closest matches (at least half the words)
  // among the brands / price chosen.
  let results = scored.filter((r) => r.matched === words.length);
  let relaxed = false;
  if (!results.filter(chosen).length && words.length > 1) {
    const most = Math.max(...scored.filter(chosen).map((r) => r.matched), 0);
    if (most >= Math.ceil(words.length / 2)) {
      results = scored.filter((r) => r.matched === most);
      relaxed = true;
    }
  }

  results.sort(sorters[filters.sort] || sorters.relevance);
  return finish(results, { words: parsed.words.map((forms) => forms[0]), corrections, relaxed });
}

// ------------------------------------------------------------------ live index

let current = null;
let loading = null;

async function loadIndex() {
  // required here: homeSectionsService loads the models this file is loaded with
  const { popularity } = require("./homeSectionsService");
  const [products, categories, groups, scores] = await Promise.all([
    Product.find({ visibility: "published", isActive: true }, INDEX_FIELDS).lean(),
    Category.find({}, { slug: 1, name: 1 }).lean(),
    SearchSynonym.find({}).lean(),
    popularity().catch(() => ({ bestseller: new Map(), trending: new Map() })),
  ]);
  const combined = new Map(scores.bestseller);
  for (const [slug, n] of scores.trending) combined.set(slug, (combined.get(slug) || 0) + n);
  return buildIndex(products, new Map(categories.map((c) => [c.slug, c.name])), { groups, popularity: combined });
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
