const Product = require("../models/Product");

/**
 * Filters for the website's filter panel (search and category pages):
 * which brands are there (with counts) and the price range, for the
 * products in view.
 *
 * Like most shops: the brand counts follow the chosen price range, and the
 * price range follows the chosen brands, so a choice never hides the other
 * filter's options.
 */

/** ?brand=aerofit,cockatoo (or ?brand=a&brand=b) -> ["aerofit", "cockatoo"] */
function brandList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .flatMap((v) => String(v ?? "").split(","))
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 50);
}

/** "" / undefined -> undefined, otherwise a number ≥ 0 */
function priceOf(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** MongoDB condition for a price range; price-on-enquiry products (0) only when no range is set. */
function priceCondition(minPrice, maxPrice) {
  if (minPrice === undefined && maxPrice === undefined) return null;
  return {
    $gt: 0,
    ...(minPrice !== undefined ? { $gte: minPrice } : {}),
    ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
  };
}

const roundDown = (n) => (n >= 1000 ? Math.floor(n / 100) * 100 : Math.floor(n));
const roundUp = (n) => (n >= 1000 ? Math.ceil(n / 100) * 100 : Math.ceil(n));

/** { min, max } of prices > 0 (rounded to ₹100 above ₹1,000), or null when none */
function priceRange(prices) {
  const priced = prices.filter((p) => p > 0);
  if (!priced.length) return null;
  return { min: roundDown(Math.min(...priced)), max: roundUp(Math.max(...priced)) };
}

const byCountThenName = (a, b) => b.count - a.count || a.name.localeCompare(b.name);

/**
 * Facets for products already in memory (the search).
 * @param products [{ brandSlug, brand, sellingPrice }]
 */
function facetsOf(products, { brands = [], minPrice, maxPrice } = {}) {
  const inPrice = (p) => {
    if (minPrice === undefined && maxPrice === undefined) return true;
    const price = Number(p.sellingPrice) || 0;
    return price > 0 && (minPrice === undefined || price >= minPrice) && (maxPrice === undefined || price <= maxPrice);
  };
  const inBrands = (p) => !brands.length || brands.includes(p.brandSlug);

  const counts = new Map();
  for (const p of products) {
    if (!p.brandSlug || !inPrice(p)) continue;
    const entry = counts.get(p.brandSlug) || { slug: p.brandSlug, name: p.brand || p.brandSlug, count: 0 };
    entry.count++;
    counts.set(p.brandSlug, entry);
  }
  // A chosen brand stays in the list (with 0) so it can be unticked.
  for (const slug of brands) if (!counts.has(slug)) counts.set(slug, { slug, name: slug, count: 0 });

  return {
    brands: [...counts.values()].sort(byCountThenName),
    price: priceRange(products.filter(inBrands).map((p) => Number(p.sellingPrice) || 0)),
  };
}

/**
 * Facets from the database (category / brand pages).
 * @param base the products query without its brand and price conditions
 */
async function facetsFromDb(base, { brands = [], minPrice, maxPrice } = {}) {
  const price = priceCondition(minPrice, maxPrice);
  const [brandCounts, range] = await Promise.all([
    Product.aggregate([
      { $match: { ...base, ...(price ? { sellingPrice: price } : {}), brandSlug: { $nin: [null, ""] } } },
      { $group: { _id: "$brandSlug", name: { $first: "$brand" }, count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { ...base, ...(brands.length ? { brandSlug: { $in: brands } } : {}), sellingPrice: { $gt: 0 } } },
      { $group: { _id: null, min: { $min: "$sellingPrice" }, max: { $max: "$sellingPrice" } } },
    ]),
  ]);

  const counts = new Map(brandCounts.map((b) => [b._id, { slug: b._id, name: b.name || b._id, count: b.count }]));
  for (const slug of brands) if (!counts.has(slug)) counts.set(slug, { slug, name: slug, count: 0 });
  return {
    brands: [...counts.values()].sort(byCountThenName),
    price: range[0] ? { min: roundDown(range[0].min), max: roundUp(range[0].max) } : null,
  };
}

module.exports = { brandList, priceOf, priceCondition, facetsOf, facetsFromDb };
