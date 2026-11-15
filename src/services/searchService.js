const Product = require('../models/Product');

/**
 * Text typed by a customer, safe to use inside a regular expression: symbols
 * like \ ( [ * + ? match themselves instead of breaking the search
 * ("Regular expression is invalid" from MongoDB).
 */
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class SearchService {
  async searchProducts(queryParams) {
    const {
      q,
      brand,
      department,
      category,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 12,
    } = queryParams;

    const filter = {
      visibility: 'published',
      isActive: true,
    };

    // Global Text Search
    if (q && q.trim()) {
      filter.$text = {
        $search: q.trim(),
      };
    }

    // Brand Filter
    if (brand) {
  filter.$or = [
    { brandSlug: brand },
    { brand: new RegExp(`^${escapeRegex(brand)}$`, "i") }
  ];
}

    // Department Filter
    if (department) {
      filter.department = department;
    }

    // Category Filter
if (category) {
  filter.$and = filter.$and || [];

  filter.$and.push({
    $or: [
      { parentCategory: category },
      { childCategory: category },
      { categoryPath: category }
    ]
  });
}

    // Price Filter
const hasMin = minPrice !== undefined && minPrice !== "";
const hasMax = maxPrice !== undefined && maxPrice !== "";

if (hasMin || hasMax) {
  filter.sellingPrice = {};

  if (hasMin) filter.sellingPrice.$gte = Number(minPrice);

  if (hasMax) filter.sellingPrice.$lte = Number(maxPrice);
}

    const sortMap = {
      newest: { createdAt: -1 },
      relevance: { score: { $meta: 'textScore' } },
      price_low_high: { sellingPrice: 1 },
      price_high_low: { sellingPrice: -1 },
      discount: { discountPercent: -1 },
      featured: { isFeatured: -1, displayOrder: 1 },
      popular: { isBestSeller: -1, createdAt: -1 },
    };

const currentSort =
  q && q.trim()
    ? sortMap[sort] || sortMap.relevance
    : sortMap[sort] || { createdAt: -1 };
    const skip = (Number(page) - 1) * Number(limit);

    let searchQuery = Product.find(filter)
      .skip(skip)
      .limit(Number(limit));

    // Include relevance score only for text search
    if (filter.$text) {
      searchQuery = searchQuery.select({
        score: { $meta: 'textScore' },
      });
    }

    const products = await searchQuery.sort(currentSort).lean();

    const totalProducts = await Product.countDocuments(filter);

    return {
      query: q || '',
      filters: {
        brand,
        department,
        category,
        minPrice,
        maxPrice,
      },
      products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalProducts,
        totalPages: Math.ceil(totalProducts / Number(limit)),
        hasNextPage: Number(page) * Number(limit) < totalProducts,
        hasPrevPage: Number(page) > 1,
      },
    };
  }

  // Autocomplete Suggestions
  async getSuggestions(keyword) {
    const text = String(keyword ?? '').trim().slice(0, 100);
    if (text.length < 2) return [];

    const products = await Product.find(
      {
        name: {
          $regex: escapeRegex(text),
          $options: 'i',
        },
        visibility: 'published',
        isActive: true,
      },
      {
        name: 1,
        slug: 1,
        thumbnail: 1,
        sellingPrice: 1,
        brand: 1,
      }
    )
      .limit(8)
      .lean();

    return products;
  }

  // Popular Search Suggestions
  async getPopularSearches() {
    return [
      'Aerofit Treadmill',
      'Home Gym',
      'Exercise Bike',
      'Commercial Treadmill',
      'Smith Machine',
      'Massage Chair',
      'Dumbbells',
      'Spin Bike',
    ];
  }
}

module.exports = new SearchService();
module.exports.escapeRegex = escapeRegex;