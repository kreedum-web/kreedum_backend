const mongoose = require("mongoose");
const HomeSection = require("../models/HomeSection");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Enquiry = require("../models/Enquiry");
const PageView = require("../models/PageView");

/**
 * The home page's product rows (see models/HomeSection.js for the rules).
 *
 * Every row: the admin's picks first (in their order), then filled up to its
 * size by its rule. Filled products are never repeated from a row above, and
 * at most 2 per brand are filled into a row so it isn't all one brand.
 * Only products on the website with a photo are shown.
 */

const BUILTINS = [
  { key: "featured", rule: "featured", title: "Featured Products", subtitle: "Hand-picked products from Kreedum." },
  { key: "ready-stock", rule: "ready-stock", title: "Ready Stock: Fastest Delivery", subtitle: "In stock at our store, ready to deliver or pick up." },
  { key: "bestsellers", rule: "bestsellers", title: "Best Sellers", subtitle: "Products customers are buying the most." },
  { key: "new-arrivals", rule: "new", title: "New Arrivals", subtitle: "Fresh products added to the store." },
  { key: "trending", rule: "trending", title: "Trending Now", subtitle: "Popular products worth checking out." },
  { key: "deals", rule: "deals", title: "Today's Deals", subtitle: "Grab the best available discounts." },
];

// Built-in rows whose picks are product ticks (the rest use productIds).
const PICK_FIELD = {
  featured: "isFeatured",
  bestsellers: "isBestSeller",
  new: "isNewArrival",
  trending: "isTrending",
  "ready-stock": "readyStock",
};

const LIVE = { isActive: true, visibility: "published" };

// What a product card needs (no long descriptions).
const CARD_FIELDS = {
  name: 1, slug: 1, brand: 1, brandSlug: 1, thumbnail: 1, images: { $slice: 1 }, sellingPrice: 1, mrp: 1,
  discountPercent: 1, maxPrice: 1, stockStatus: 1, badge: 1, sku: 1, categoryPath: 1, createdAt: 1,
  isFeatured: 1, isBestSeller: 1, isNewArrival: 1, isTrending: 1, readyStock: 1, displayOrder: 1,
  "variants.price": 1, "variants.mrp": 1,
};

const MAX_PER_BRAND = 2;
const DEAL_POOL = 40; // today's deals rotate daily among the 40 biggest discounts

/** Create the built-in rows the first time (later edits are kept). */
async function ensureBuiltins() {
  await HomeSection.bulkWrite(
    BUILTINS.map((b, i) => ({
      updateOne: {
        filter: { key: b.key },
        update: { $setOnInsert: { ...b, displayOrder: (i + 1) * 10, isVisible: true, limit: 8 } },
        upsert: true,
      },
    }))
  );
}

// ------------------------------------------------------------------ popularity

const DAY = 24 * 60 * 60 * 1000;

/**
 * Scores per product slug from the shop's own data:
 *   bestseller  last 90 days: orders ×5, product enquiries ×2, page views ×0.05
 *   trending    last 14 days: page views, enquiries ×3, orders ×5
 */
async function popularity(now = new Date()) {
  const since90 = new Date(now - 90 * DAY);
  const since14 = new Date(now - 14 * DAY);
  const recent = (field) => ({ $cond: [{ $gte: [field, since14] }, 1, 0] });

  const [orders, enquiries, views] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: since90 }, orderStatus: { $nin: ["CANCELLED", "RETURNED", "AWAITING_PAYMENT"] } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.slug",
          all: { $sum: { $ifNull: ["$items.quantity", 1] } },
          recent: { $sum: { $multiply: [{ $ifNull: ["$items.quantity", 1] }, recent("$createdAt")] } },
        },
      },
    ]),
    Enquiry.aggregate([
      { $match: { createdAt: { $gte: since90 }, kind: { $in: ["product", "whatsapp"] }, productSlug: { $nin: ["", null] } } },
      { $group: { _id: "$productSlug", all: { $sum: 1 }, recent: { $sum: recent("$createdAt") } } },
    ]),
    PageView.aggregate([
      { $match: { at: { $gte: since90 }, path: /^\/products\/[^/]+$/ } },
      { $group: { _id: "$path", all: { $sum: 1 }, recent: { $sum: recent("$at") } } },
    ]),
  ]);

  const bestseller = new Map();
  const trending = new Map();
  const add = (map, slug, n) => slug && n && map.set(slug, (map.get(slug) || 0) + n);
  for (const o of orders) {
    add(bestseller, o._id, o.all * 5);
    add(trending, o._id, o.recent * 5);
  }
  for (const e of enquiries) {
    add(bestseller, e._id, e.all * 2);
    add(trending, e._id, e.recent * 3);
  }
  for (const v of views) {
    const slug = decodeURIComponent(v._id.slice("/products/".length));
    add(bestseller, slug, v.all * 0.05);
    add(trending, slug, v.recent);
  }
  return { bestseller, trending };
}

// ------------------------------------------------------------------ choosing products

/** The same "random" order all day (deals change daily, not on every visit). */
function dailyShuffle(items, day) {
  let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const hasPhoto = (p) => Boolean(p.thumbnail || p.images?.length);
const byNumber = (score) => (a, b) => score(b) - score(a);

/** Picked products of a row, in order (only those on the website). */
function picksOf(section, products, byId) {
  const field = PICK_FIELD[section.rule];
  if (field) {
    return products
      .filter((p) => p[field])
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || a.name.localeCompare(b.name));
  }
  return (section.productIds || []).map((id) => byId.get(String(id))).filter(Boolean);
}

/** Products to fill a row with, best first. */
function fillPool(section, products, { bestseller, trending }, day) {
  const score = (map) => (p) => map.get(p.slug) || 0;
  const combined = (p) => (bestseller.get(p.slug) || 0) + (trending.get(p.slug) || 0);
  const newest = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  const then = (...sorters) => (a, b) => {
    for (const s of sorters) {
      const r = s(a, b);
      if (r) return r;
    }
    return 0;
  };
  const priced = (p) => p.sellingPrice > 0;

  switch (section.rule) {
    case "featured":
      return [...products].sort(then(byNumber(combined), byNumber((p) => p.discountPercent || 0)));
    case "bestsellers":
      return [...products].sort(then(byNumber(score(bestseller)), byNumber(combined), byNumber((p) => p.discountPercent || 0)));
    case "new":
      return [...products].sort(newest);
    case "trending":
      return [...products].sort(then(byNumber(score(trending)), byNumber(combined), newest));
    case "deals": {
      const onSale = products.filter((p) => priced(p) && p.discountPercent > 0 && p.stockStatus !== "out_of_stock");
      const hot = onSale.filter((p) => p.badge === "Hot Deal");
      const biggest = onSale.filter((p) => p.badge !== "Hot Deal").sort(byNumber((p) => p.discountPercent)).slice(0, DEAL_POOL);
      return [...hot, ...dailyShuffle(biggest, day)];
    }
    case "custom": {
      if (section.autoFill === false) return [];
      const f = section.filters || {};
      const brands = (f.brandSlugs || []).filter(Boolean);
      const pool = products.filter(
        (p) =>
          (!f.categorySlug || (p.categoryPath || []).includes(f.categorySlug)) &&
          (!brands.length || brands.includes(p.brandSlug)) &&
          (f.minPrice == null || (priced(p) && p.sellingPrice >= f.minPrice)) &&
          (f.maxPrice == null || (priced(p) && p.sellingPrice <= f.maxPrice)) &&
          (f.minDiscount == null || (p.discountPercent || 0) >= f.minDiscount) &&
          (!f.readyStockOnly || p.readyStock)
      );
      const sorts = {
        popular: then(byNumber(combined), newest),
        newest,
        discount: byNumber((p) => p.discountPercent || 0),
        price_low: (a, b) => (priced(a) ? a.sellingPrice : Infinity) - (priced(b) ? b.sellingPrice : Infinity),
        price_high: byNumber((p) => p.sellingPrice || 0),
      };
      return pool.sort(sorts[f.sort] || sorts.popular);
    }
    default:
      return []; // ready-stock: only the products marked ready stock
  }
}

/**
 * Products of one row: picks, then the rule (skipping `used`, at most 2 per
 * brand; if that leaves the row short, the brand limit is lifted).
 * Adds what it shows to `used`. Returns [{ product, picked }].
 */
function chooseProducts(section, { products, byId, popularity: pop, used = new Set(), day }) {
  const limit = section.limit || 8;
  const chosen = [];
  const taken = new Set();
  for (const p of picksOf(section, products, byId)) {
    if (chosen.length >= limit) break;
    if (!hasPhoto(p) || taken.has(String(p._id))) continue;
    chosen.push({ product: p, picked: true });
    taken.add(String(p._id));
  }

  const pool = fillPool(section, products, pop, day).filter(
    (p) => hasPhoto(p) && !taken.has(String(p._id)) && !used.has(String(p._id))
  );
  const perBrand = new Map();
  chosen.forEach(({ product }) => perBrand.set(product.brandSlug, (perBrand.get(product.brandSlug) || 0) + 1));
  for (const strict of [true, false]) {
    for (const p of pool) {
      if (chosen.length >= limit) break;
      if (taken.has(String(p._id))) continue;
      if (strict && (perBrand.get(p.brandSlug) || 0) >= MAX_PER_BRAND) continue;
      chosen.push({ product: p, picked: false });
      taken.add(String(p._id));
      perBrand.set(p.brandSlug, (perBrand.get(p.brandSlug) || 0) + 1);
    }
  }
  taken.forEach((id) => used.add(id));
  return chosen;
}

/** Is a row shown now (switched on, and within its dates)? */
function isShowing(section, now = new Date()) {
  if (!section.isVisible) return false;
  if (section.startsAt && new Date(section.startsAt) > now) return false;
  if (section.endsAt && new Date(section.endsAt) < now) return false;
  return true;
}

const indiaDay = (date) => new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** A link to see more, where a row has an obvious one. */
function viewAllOf(section) {
  if (section.rule === "custom" && section.filters?.categorySlug) {
    const brands = section.filters.brandSlugs?.length ? `?brand=${section.filters.brandSlugs.join(",")}` : "";
    return `/categories/${section.filters.categorySlug}${brands}`;
  }
  return "";
}

// ------------------------------------------------------------------ cache

const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { at, sections }

/** Forget the cached rows (after an admin change). */
function clearCache() {
  cache = null;
}

async function loadInputs(now) {
  const [products, pop] = await Promise.all([Product.find(LIVE, CARD_FIELDS).lean(), popularity(now)]);
  return { products, byId: new Map(products.map((p) => [String(p._id), p])), popularity: pop, day: indiaDay(now) };
}

/**
 * The rows the website shows now, in order, with their products.
 * Cached for 5 minutes. Rows with no products are left out.
 */
async function homeSections({ now = new Date(), fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.sections;
  await ensureBuiltins();
  const sections = (await HomeSection.find({}).sort({ displayOrder: 1, createdAt: 1 }).lean()).filter((s) => isShowing(s, now));
  const inputs = await loadInputs(now);
  const used = new Set();
  const result = [];
  for (const section of sections) {
    const products = chooseProducts(section, { ...inputs, used }).map(({ product }) => product);
    if (!products.length) continue;
    result.push({
      id: String(section._id),
      key: section.key,
      rule: section.rule,
      title: section.title,
      subtitle: section.subtitle,
      viewAll: viewAllOf(section),
      products,
    });
  }
  cache = { at: Date.now(), sections: result };
  return result;
}

/** What a row would show (for the admin; ignores dates, visibility and other rows). */
async function previewSection(section, now = new Date()) {
  const inputs = await loadInputs(now);
  return chooseProducts(section, { ...inputs, used: new Set() }).map(({ product, picked }) => ({
    id: String(product._id),
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    thumbnail: product.thumbnail || product.images?.[0] || "",
    sellingPrice: product.sellingPrice,
    discountPercent: product.discountPercent || 0,
    readyStock: Boolean(product.readyStock),
    picked,
  }));
}

const isObjectId = (id) => mongoose.isValidObjectId(id);

module.exports = {
  BUILTINS,
  PICK_FIELD,
  ensureBuiltins,
  popularity,
  chooseProducts,
  fillPool,
  isShowing,
  dailyShuffle,
  homeSections,
  previewSection,
  clearCache,
  isObjectId,
};
