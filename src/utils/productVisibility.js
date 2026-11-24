const Brand = require("../models/Brand");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { isHiddenBrand } = require("./brandRules");

/**
 * Why a product is off the website (product.hiddenBy):
 *   "admin"          switched off on its own page: stays off until switched on there
 *   "admin-brand"    its brand is switched off in the admin
 *   "brand-rule"     its brand is not sold (src/config/brandRules)
 *   "admin-category" its category (or a category above it) is hidden in the admin
 *
 * The last three follow their brand / category: they're worked out again
 * whenever a brand or category is switched on or off, a product's brand or
 * category changes, or the catalogue is rebuilt. A product switched off by
 * hand ("admin") is never switched back on by them.
 */
const FOLLOWS = ["admin-brand", "brand-rule", "admin-category"];

const isLive = (p) => p.isActive !== false && p.visibility === "published";

/** Hidden brands and categories, as Sets of slugs. */
async function visibilityContext() {
  const [brands, categories] = await Promise.all([
    Brand.find({ adminHidden: true }, { slug: 1 }).lean(),
    Category.find({ isActive: false }, { slug: 1 }).lean(),
  ]);
  return {
    hiddenBrands: new Set(brands.map((b) => b.slug)),
    hiddenCategories: new Set(categories.map((c) => c.slug)),
  };
}

/** "" = may be shown; otherwise the reason it must stay hidden. */
function forcedHideReason(p, { hiddenBrands = new Set(), hiddenCategories = new Set() } = {}) {
  if (p.brandSlug && hiddenBrands.has(p.brandSlug)) return "admin-brand";
  if (p.brandSlug && isHiddenBrand(p.brandSlug)) return "brand-rule";
  if ((p.categoryPath || []).some((slug) => hiddenCategories.has(slug))) return "admin-category";
  return "";
}

/**
 * Bring p.isActive / visibility / hiddenBy in line with its brand and
 * categories. Changes p in place; returns true when something changed.
 */
function reconcileVisibility(p, context) {
  const reason = forcedHideReason(p, context);
  if (reason && isLive(p)) {
    Object.assign(p, { isActive: false, visibility: "hidden", hiddenBy: reason });
    return true;
  }
  if (reason && FOLLOWS.includes(p.hiddenBy) && p.hiddenBy !== reason) {
    p.hiddenBy = reason; // still hidden, for another reason now
    return true;
  }
  if (!reason && FOLLOWS.includes(p.hiddenBy)) {
    Object.assign(p, { isActive: true, visibility: "published", hiddenBy: "" });
    return true;
  }
  return false;
}

/** Live products per category and per brand, written to Category / Brand productCount. */
async function recountProducts() {
  const live = { isActive: true, visibility: "published" };
  const [byCategory, byBrand, categories, brands] = await Promise.all([
    Product.aggregate([{ $match: live }, { $unwind: "$categoryPath" }, { $group: { _id: "$categoryPath", n: { $sum: 1 } } }]),
    Product.aggregate([{ $match: live }, { $group: { _id: "$brandSlug", n: { $sum: 1 } } }]),
    Category.find({}, { slug: 1, productCount: 1 }).lean(),
    Brand.find({}, { slug: 1, productCount: 1 }).lean(),
  ]);
  const writes = (docs, counts) => {
    const n = new Map(counts.map((c) => [c._id, c.n]));
    return docs
      .filter((d) => (d.productCount || 0) !== (n.get(d.slug) || 0))
      .map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { productCount: n.get(d.slug) || 0 } } } }));
  };
  const categoryWrites = writes(categories, byCategory);
  const brandWrites = writes(brands, byBrand);
  if (categoryWrites.length) await Category.bulkWrite(categoryWrites);
  if (brandWrites.length) await Brand.bulkWrite(brandWrites);
}

/**
 * After a brand or category was switched on/off: work out again every
 * matching product that's live or hidden because of a brand / category.
 * @param filter e.g. { categoryPath: "cardio" } or { brandSlug: "aerofit" }; {} = every product
 * @param {{ dryRun?: boolean }} options dryRun: only report, change nothing
 * @returns {{ hidden: number, shown: number, changes: { name, from, to }[] }}
 */
async function refreshVisibility(filter, { dryRun = false } = {}) {
  const context = await visibilityContext();
  const products = await Product.find(
    { ...filter, $or: [{ isActive: true, visibility: "published" }, { hiddenBy: { $in: FOLLOWS } }] },
    { name: 1, brandSlug: 1, categoryPath: 1, isActive: 1, visibility: 1, hiddenBy: 1 }
  ).lean();

  const result = { hidden: 0, shown: 0, changes: [] };
  const label = (p) => (isLive(p) ? "live" : `hidden (${p.hiddenBy || "no reason"})`);
  const writes = [];
  for (const p of products) {
    const wasLive = isLive(p);
    const from = label(p);
    if (!reconcileVisibility(p, context)) continue;
    result.changes.push({ name: p.name, from, to: label(p) });
    if (wasLive && !isLive(p)) result.hidden++;
    if (!wasLive && isLive(p)) result.shown++;
    writes.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { isActive: p.isActive, visibility: p.visibility, hiddenBy: p.hiddenBy } },
      },
    });
  }
  if (dryRun) return result;
  if (writes.length) await Product.bulkWrite(writes);
  await recountProducts();
  return result;
}

module.exports = {
  FOLLOWS,
  isLive,
  visibilityContext,
  forcedHideReason,
  reconcileVisibility,
  recountProducts,
  refreshVisibility,
};
