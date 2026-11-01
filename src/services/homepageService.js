const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const siteContentService = require("./siteContentService");

class HomepageService {

  // ----------------------------
  // Hero / offer banners: managed in the database (hero_banners),
  // images in Cloudinary kreedum/homepage/hero
  // ----------------------------
  async getHeroBanners() {
    return siteContentService.getHeroBanners();
  }

  // ----------------------------
  // Homepage Categories
  // ----------------------------
  async getCategories(limit = 8) {
    const categories = await Category.aggregate([
      { $match: { level: 1 } },
      {
  $lookup: {
    from: "products",
    let: { categorySlug: "$slug" },
    pipeline: [
      {
        $match: {
          $expr: {
            $or: [
              { $eq: ["$department", "$$categorySlug"] },
              { $eq: ["$parentCategory", "$$categorySlug"] },
              { $eq: ["$childCategory", "$$categorySlug"] }
            ]
          },
          visibility: "published",
          isActive: true
        }
      }
    ],
    as: "products"
  },
},
      {
      $project: {
        name: 1,
        slug: 1,
        image: 1,
        icon: 1,
        productCount: { $size: "$products" },
      },
    },

    { $sort: { productCount: -1, name: 1 } },
    { $limit: limit },
  ]);

  return categories;
}
  // ----------------------------
  // Featured Products
  // ----------------------------
  async getFeaturedProducts(limit = 8) {
    let products = await Product.find({
      isFeatured: true,
      visibility: "published",
      isActive: true,
    })
      .sort({ displayOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    // Fallback
    if (!products.length) {
      products = await Product.find({
        visibility: "published",
        isActive: true,
      })
        .sort({ discountPercent: -1 })
        .limit(limit)
        .lean();
    }

    return products;
  }

  // ----------------------------
  // Best Sellers
  // ----------------------------
  async getBestSellers(limit = 8) {
    let products = await Product.find({
      isBestSeller: true,
      visibility: "published",
      isActive: true,
    })
      .sort({ displayOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!products.length) {
      products = await Product.find({
        visibility: "published",
        isActive: true,
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    }

    return products;
  }

  // ----------------------------
  // New Arrivals
  // ----------------------------
  async getNewArrivals(limit = 8) {
    let products = await Product.find({
      isNewArrival: true,
      visibility: "published",
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (!products.length) {
      products = await Product.find({
        visibility: "published",
        isActive: true,
      })
        .sort({ lastSyncedAt: -1 })
        .limit(limit)
        .lean();
    }

    return products;
  }

  // ----------------------------
  // Trending Products
  // ----------------------------
  async getTrendingProducts(limit = 8) {
    let products = await Product.find({
      isTrending: true,
      visibility: "published",
      isActive: true,
    })
      .sort({ displayOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!products.length) {
      products = await Product.find({
        visibility: "published",
        isActive: true,
      })
        .sort({ discountPercent: -1, createdAt: -1 })
        .limit(limit)
        .lean();
    }

    return products;
  }

  // ----------------------------
  // Today's Deals
  // ----------------------------
  async getDeals(limit = 8) {
    return Product.find({
      visibility: "published",
      isActive: true,
    })
      .sort({ discountPercent: -1 })
      .limit(limit)
      .lean();
  }

  // ----------------------------
  // Popular Brands
  // ----------------------------
  async getPopularBrands(limit = 8) {
    const brands = await Brand.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "name",
          foreignField: "brand",
          as: "products",
        },
      },
      {
        $project: {
          name: 1,
          slug: 1,
          logo: 1,
          productCount: {
            $size: {
              $filter: {
                input: "$products",
                as: "product",
                cond: {
                  $and: [
                    { $eq: ["$$product.visibility", "published"] },
                    { $eq: ["$$product.isActive", true] },
                  ],
                },
              },
            },
          },
        },
      },
      { $sort: { productCount: -1 } },
      { $limit: limit },
    ]);

    return brands;
  }

  // ----------------------------
  // Homepage Stats
  // ----------------------------
  async getHomepageStats() {
    const [products, categories, brands] = await Promise.all([
      Product.countDocuments({
        visibility: "published",
        isActive: true,
      }),
      Category.countDocuments(),
      Brand.countDocuments(),
    ]);

    return {
      totalProducts: products,
      totalCategories: categories,
      totalBrands: brands,
    };
  }

  // ----------------------------
  // Homepage Payload
  // ----------------------------
  async getHomepageData() {
    const [
      heroBanners,
      categories,
      featuredProducts,
      bestSellers,
      newArrivals,
      trendingProducts,
      deals,
      popularBrands,
      stats,
    ] = await Promise.all([
      this.getHeroBanners(),
      this.getCategories(),
      this.getFeaturedProducts(),
      this.getBestSellers(),
      this.getNewArrivals(),
      this.getTrendingProducts(),
      this.getDeals(),
      this.getPopularBrands(),
      this.getHomepageStats(),
    ]);

    return {
      heroBanners,
      categories,
      featuredProducts,
      bestSellers,
      newArrivals,
      trendingProducts,
      deals,
      popularBrands,
      stats,
    };
  }
}

module.exports = new HomepageService();