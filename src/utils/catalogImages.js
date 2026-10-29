const Product = require("../models/Product");

/**
 * One representative product photo per category and per brand, for the
 * website's category tiles and brand cards (the catalogue has no category or
 * brand images of its own).
 *
 * Featured / best-selling products are preferred, then the most expensive
 * (main equipment photographs better than small accessories). Computed
 * from one small query and cached for 10 minutes.
 */
const TTL_MS = 10 * 60 * 1000;
let cache = null;

async function getCatalogImages() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const products = await Product.find(
    { visibility: "published", isActive: true, thumbnail: { $nin: ["", null] } },
    { thumbnail: 1, department: 1, parentCategory: 1, childCategory: 1, brandSlug: 1 }
  )
    // featured first, then the main equipment (highest price) rather than accessories
    .sort({ isFeatured: -1, isBestSeller: -1, sellingPrice: -1 })
    .lean();

  const byCategory = new Map();
  const byBrand = new Map();

  for (const product of products) {
    for (const slug of [product.department, product.parentCategory, product.childCategory]) {
      if (slug && !byCategory.has(slug)) byCategory.set(slug, product.thumbnail);
    }
    if (product.brandSlug && !byBrand.has(product.brandSlug)) {
      byBrand.set(product.brandSlug, product.thumbnail);
    }
  }

  cache = { at: Date.now(), value: { byCategory, byBrand } };
  return cache.value;
}

module.exports = getCatalogImages;
