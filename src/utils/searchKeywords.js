const generateKeywords = require("./generateKeywords");

/**
 * A product's search words: name, brand, SKU and the names of its categories.
 * @param {{ name, brand, sku, categoryPath }} product
 * @param {Map<string, { name: string }>} categoriesBySlug
 */
function searchKeywordsFor(product, categoriesBySlug) {
  const path = product.categoryPath || [];
  const categoryWords = path.map((slug) => categoriesBySlug.get(slug)?.name).filter(Boolean);
  return [
    ...new Set([
      ...generateKeywords({ name: product.name || "", brand: product.brand, sku: product.sku, categorySlug: path.at(-1) || "" }),
      ...categoryWords.map((w) => w.toLowerCase()),
    ]),
  ];
}

module.exports = { searchKeywordsFor };
