const Product = require('../models/Product');

class ProductService 
{
async getProductsByCategory(slug, query) {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 12;
  const skip = (page - 1) * limit;

  const filter = {
    visibility: 'published',
    isActive: true,
    $or: [
      { department: slug },
      { parentCategory: slug },
      { childCategory: slug },
    ],
  };

  // Brand narrows the category; it must not replace the category filter.
  if (query.brand) {
    const brand = String(query.brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$and = [
      {
        $or: [
          { brandSlug: query.brand },
          { brand: new RegExp(`^${brand}$`, "i") },
        ],
      },
    ];
  }

  if (query.minPrice || query.maxPrice) {
    filter.sellingPrice = {};

    if (query.minPrice)
      filter.sellingPrice.$gte = Number(query.minPrice);

    if (query.maxPrice)
      filter.sellingPrice.$lte = Number(query.maxPrice);
  }

  const sortMap = {
    newest: { createdAt: -1 },
    price_low_high: { sellingPrice: 1 },
    price_high_low: { sellingPrice: -1 },
    discount: { discountPercent: -1 },
    name: { name: 1 },
    featured: {
  isFeatured: -1,
  displayOrder: 1,
    },
popular: {
  isBestSeller: -1,
  createdAt: -1,
},
  };

  const sort = sortMap[query.sort] || { createdAt: -1 };

  const products = await Product.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  const totalProducts = await Product.countDocuments(filter);

  return {
    products,
    pagination: {
      page,
      limit,
      totalProducts,
      totalPages: Math.ceil(totalProducts / limit),
      hasNextPage: page * limit < totalProducts,
      hasPrevPage: page > 1,
    },
  };
}
}

module.exports = new ProductService();