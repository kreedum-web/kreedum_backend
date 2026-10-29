const generateSlug = require("./generateSlug");
const generateKeywords = require("./generateKeywords");
const resolveCategory = require("./categoryResolver");
const extractSpecifications = require("./extractSpecifications");
const { variantsFromSupplier } = require("./productVariants");

/**
 * Convert Metro Sports product into Kreedum ecommerce product.
 */
function transformProduct(product) {
  // Resolve Kreedum category hierarchy
  const category = resolveCategory(product.categorySlug);

  // SEO slug
  let slug = generateSlug(product.name);

// Make slug unique using SKU if available
  if (product.sku) {
  const skuSlug = generateSlug(product.sku);
  slug = `${slug}-${skuSlug}`;
   }

  // Calculate discount
  let discountPercent = 0;

  if (
    product.mrp &&
    product.sellingPrice &&
    product.mrp > product.sellingPrice
  ) {
    discountPercent = Math.round(
      ((product.mrp - product.sellingPrice) / product.mrp) * 100
    );
  }

  // Generate search keywords
  const searchKeywords = generateKeywords({
    name: product.name,
    brand: product.brand,
    sku: product.sku,
    categorySlug: product.categorySlug,
  });

  // Extract structured specifications + highlights
  const { specifications, highlights } = extractSpecifications(
    product.features || []
  );

  return {
    supplier: product.supplier || "metrosports",

    name: product.name,
    slug,

    sku: product.sku || "",

    brand: product.brand || "Unknown",

    department: category.department,
    parentCategory: category.parent,
    childCategory: category.categorySlug,
    categoryPath: category.categoryPath,

    mrp: product.mrp || 0,
    sellingPrice: product.sellingPrice || product.mrp || 0,
    discountPercent,

    // Weight / size options, each with its own price.
    ...variantsFromSupplier(product, product.sellingPrice || product.mrp || 0),

    thumbnail: product.thumbnail || product.images?.[0] || "",
    images: product.images || [],

    descriptionHtml: product.descriptionHtml || "",
    descriptionText: product.descriptionText || "",

    specifications,
    features: product.features || [],
    highlights,

    searchKeywords,

    seo: {
      title: `${product.name} | Kreedum Sports Lucknow`,
      description:
        product.descriptionText?.slice(0, 155) ||
        `${product.name} available at Kreedum Sports Lucknow.`,
      keywords: searchKeywords,
    },

    visibility: "published",

    stockStatus:
      product.status === "active"
        ? "in_stock"
        : "enquiry_only",

    isFeatured: false,
    isBestSeller: false,
    isNewArrival: false,

    isActive: product.status === "active",

    sourceUrl: product.url,
    lastSyncedAt: product.lastScrapedAt || new Date(),
  };
}

module.exports = transformProduct;