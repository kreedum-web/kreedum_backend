const Product = require("../models/Product");

/**
 * "Related products" on a product page:
 *   - from the product's own category (its deepest one), topped up from the
 *     category above it when that's small;
 *   - one per product family: "Dumbbell 2 kg", "Dumbbell 3 kg" and
 *     "Dumbbell 4 kg (Red)" count as one, and never the product's own family;
 *   - nearest in price first, at most 3 per brand (fewer if enough others).
 */

const LIMIT = 8;
const FIELDS = "name slug thumbnail images sellingPrice mrp maxPrice discountPercent brand brandSlug badge stockStatus readyStock";

const COLOURS =
  "black white red blue green yellow orange pink purple grey gray silver gold brown navy maroon beige multicolor multicolour assorted";
const UNITS = "kg|kgs|g|gm|gms|lb|lbs|mm|cm|m|mtr|ft|feet|inch|inches|in|l|ltr|ml|oz|pcs|pc|pieces|pair|pairs|set|no|size";

/**
 * The name without sizes, weights, colours and pack sizes: products in one
 * family share it. "Hex Dumbbell 5 Kg (Pair)" -> "hex dumbbell".
 */
function familyOf(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // (Red), [Pack of 2]
    .replace(new RegExp(`\\b(${COLOURS.split(" ").join("|")})\\b`, "g"), " ")
    .replace(new RegExp(`\\b(pack|set) of \\d+\\b`, "g"), " ")
    .replace(/\bsize\s*\w+\b/g, " ") // size 5, size XL
    .replace(/\d+(\.\d+)?\s*[x×*]\s*\d+(\.\d+)?(\s*[x×*]\s*\d+(\.\d+)?)?/g, " ") // 120 x 60 (x 2)
    .replace(new RegExp(`(\\d+(\\.\\d+)?\\s*-\\s*)?\\d+(\\.\\d+)?\\s*(${UNITS})\\b`, "g"), " ") // 5kg, 6 mm, 2-10 kg
    .replace(/(^|\s)(kg|kgs|lbs?|mm|cm|pair|pairs|pcs)(?=\s|$)/g, " ")
    // model numbers (AF-404, PRO 500) stay: different models aren't one family
    .replace(/["',+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order candidates: nearest price first, family and brand limits applied. */
function pickRelated(product, candidates, limit = LIMIT) {
  const ownFamily = familyOf(product.name);
  const price = Number(product.sellingPrice) || 0;
  const distance = (p) => {
    const q = Number(p.sellingPrice) || 0;
    if (!price || !q) return price || q ? 50 : 0; // price on request: after the priced ones
    return Math.abs(Math.log(q / price));
  };
  const sorted = [...candidates]
    .filter((p) => String(p._id) !== String(product._id) && p.slug !== product.slug)
    .sort((a, b) => distance(a) - distance(b));

  const families = new Set([ownFamily]);
  const unique = [];
  for (const p of sorted) {
    const family = familyOf(p.name);
    if (families.has(family)) continue;
    families.add(family);
    unique.push(p);
  }

  const chosen = [];
  const perBrand = new Map();
  for (const maxPerBrand of [3, Infinity]) {
    for (const p of unique) {
      if (chosen.length >= limit) break;
      if (chosen.includes(p)) continue;
      if ((perBrand.get(p.brandSlug) || 0) >= maxPerBrand) continue;
      chosen.push(p);
      perBrand.set(p.brandSlug, (perBrand.get(p.brandSlug) || 0) + 1);
    }
  }
  // keep the nearest-price order after the brand pass
  return chosen.sort((a, b) => distance(a) - distance(b));
}

async function relatedProducts(product, limit = LIMIT) {
  const path = product.categoryPath?.length
    ? product.categoryPath
    : [product.department, product.parentCategory, product.childCategory].filter(Boolean);
  if (!path.length) return [];

  const live = { visibility: "published", isActive: true, _id: { $ne: product._id } };
  let candidates = [];
  // Own category first; then the one above it if that gives too few.
  for (const slug of [...path].reverse().slice(0, 2)) {
    const more = await Product.find({ ...live, categoryPath: slug, _id: { $nin: [product._id, ...candidates.map((p) => p._id)] } })
      .select(FIELDS)
      .limit(150)
      .lean();
    candidates = [...candidates, ...more];
    const picked = pickRelated(product, candidates, limit);
    if (picked.length >= limit) return picked;
  }
  return pickRelated(product, candidates, limit);
}

module.exports = { relatedProducts, pickRelated, familyOf };
