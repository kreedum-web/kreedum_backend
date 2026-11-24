const { brandList, priceCondition, priceOf } = require("./productFacets");
/**
 * Build Mongo query and sorting from request query params.
 */

function buildProductQuery(queryParams) {
  const query = {
    visibility: "published",
    isActive: true,
  };

  const {
    department,
    parentCategory,
    childCategory,
    brand,
    stockStatus,
    featured,
    bestSeller,
    newArrival,
    trending,
    minPrice,
    maxPrice,
    sort,
  } = queryParams;

  // Category Filters
  if (department) query.department = department;

  if (parentCategory) query.parentCategory = parentCategory;

  if (childCategory) query.childCategory = childCategory;

  // Brand filter: one brand or several (?brand=aerofit,cockatoo)
  const brands = brandList(brand);
  if (brands.length) query.brandSlug = brands.length === 1 ? brands[0] : { $in: brands };

  // Stock Filter
  if (stockStatus) query.stockStatus = stockStatus;

  // Homepage Filters
  if (featured === "true") query.isFeatured = true;

  if (bestSeller === "true") query.isBestSeller = true;

  if (newArrival === "true") query.isNewArrival = true;

  if (trending === "true") query.isTrending = true;

  // Price range (price-on-enquiry products are left out once a range is set)
  const price = priceCondition(priceOf(minPrice), priceOf(maxPrice));
  if (price) query.sellingPrice = price;

  // Sorting
  let sortOption = {
    createdAt: -1,
  };

  switch (sort) {
    case "price_low_high":
      sortOption = { sellingPrice: 1 };
      break;

    case "price_high_low":
      sortOption = { sellingPrice: -1 };
      break;

    case "discount":
      sortOption = { discountPercent: -1 };
      break;

    case "popular":
      sortOption = { popularityScore: -1 };
      break;

    case "featured":
  sortOption = {
    isFeatured: -1,
    displayOrder: 1,
    createdAt: -1,
  };
  break;

    default:
      sortOption = { createdAt: -1 };
  }

  return { query, sortOption };
}

module.exports = buildProductQuery;