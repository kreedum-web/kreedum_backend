const Product = require('../models/Product');
const { getIndex, searchIndex } = require('./searchIndex');

/**
 * Text typed by a customer, safe to use inside a regular expression: symbols
 * like \ ( [ * + ? match themselves instead of breaking the search
 * ("Regular expression is invalid" from MongoDB).
 */
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PAGE_FIELDS_FOR_SUGGESTIONS = ["_id", "name", "slug", "thumbnail", "sellingPrice", "brand"];

class SearchService {
  /**
   * GET /api/v1/search — with a search (q): the in-memory search
   * (src/services/searchIndex.js): any word order and capitals, typos, price
   * phrases ("treadmill under 1 lakh"). Without q: the filters only.
   */
  async searchProducts(queryParams) {
    const { q, brand, department, category, minPrice, maxPrice, sort } = queryParams;
    const page = Math.max(1, Number(queryParams.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(queryParams.limit) || 12));
    const text = String(q ?? '').trim();

    if (text) {
      const index = await getIndex();
      const found = searchIndex(index, text, { brand, department, category, minPrice, maxPrice, sort });
      const pageIds = found.results.slice((page - 1) * limit, page * limit).map((r) => r.product._id);
      const docs = await Product.find({ _id: { $in: pageIds } }).lean();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const products = pageIds.map((id) => byId.get(String(id))).filter(Boolean);
      return this.result({
        q: text,
        filters: { brand, department, category, minPrice: found.minPrice, maxPrice: found.maxPrice },
        products,
        total: found.results.length,
        page,
        limit,
        // What the search understood, for "Showing … under ₹1,00,000" / "Did you mean …"
        interpreted: {
          words: found.words,
          minPrice: found.minPrice ?? null,
          maxPrice: found.maxPrice ?? null,
          corrections: found.corrections,
          relaxed: found.relaxed,
        },
      });
    }

    // ---------- no search words: filters only
    const filter = { visibility: 'published', isActive: true };
    if (brand) filter.$or = [{ brandSlug: brand }, { brand: new RegExp(`^${escapeRegex(brand)}$`, 'i') }];
    if (department) filter.department = department;
    if (category) {
      filter.$and = [{ $or: [{ parentCategory: category }, { childCategory: category }, { categoryPath: category }] }];
    }
    const hasMin = minPrice !== undefined && minPrice !== '';
    const hasMax = maxPrice !== undefined && maxPrice !== '';
    if (hasMin || hasMax) {
      filter.sellingPrice = {};
      if (hasMin) filter.sellingPrice.$gte = Number(minPrice);
      if (hasMax) filter.sellingPrice.$lte = Number(maxPrice);
    }

    const sortMap = {
      newest: { createdAt: -1 },
      price_low_high: { sellingPrice: 1 },
      price_high_low: { sellingPrice: -1 },
      discount: { discountPercent: -1 },
      featured: { isFeatured: -1, displayOrder: 1 },
      popular: { isBestSeller: -1, createdAt: -1 },
    };
    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortMap[sort] || { createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    return this.result({ q: '', filters: { brand, department, category, minPrice, maxPrice }, products, total, page, limit });
  }

  result({ q, filters, products, total, page, limit, interpreted }) {
    return {
      query: q,
      filters,
      ...(interpreted ? { interpreted } : {}),
      products,
      pagination: {
        page,
        limit,
        totalProducts: total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  // Autocomplete: the same search, top 8.
  async getSuggestions(keyword) {
    const text = String(keyword ?? '').trim().slice(0, 100);
    if (text.length < 2) return [];
    const index = await getIndex();
    const { results } = searchIndex(index, text);
    return results
      .slice(0, 8)
      .map(({ product }) => Object.fromEntries(PAGE_FIELDS_FOR_SUGGESTIONS.map((field) => [field, product[field]])));
  }

  // Popular Search Suggestions
  async getPopularSearches() {
    return [
      'Aerofit Treadmill',
      'Multi Gym',
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