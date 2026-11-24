const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const siteContentService = require("./siteContentService");
const { homeSections } = require("./homeSectionsService");

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
      // Departments hidden in the admin are not shown.
      { $match: { level: 1, isActive: { $ne: false } } },
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
  // Product rows: set up in the admin (Homepage page), see homeSectionsService
  // ----------------------------
  async getSections() {
    return homeSections();
  }

  /** One built-in row's products ([] when that row is hidden or empty). */
  async rowProducts(key, limit) {
    const row = (await homeSections()).find((s) => s.key === key);
    return (row?.products || []).slice(0, limit);
  }

  async getFeaturedProducts(limit = 8) {
    return this.rowProducts("featured", limit);
  }

  async getDeals(limit = 8) {
    return this.rowProducts("deals", limit);
  }

  // ----------------------------
  // Popular Brands
  // ----------------------------
  async getPopularBrands(limit = 8) {
    const brands = await Brand.aggregate([
      { $match: { isActive: { $ne: false } } },
      {
        $lookup: {
          from: "products",
          // by slug: a brand renamed in the admin still finds its products
          localField: "slug",
          foreignField: "brandSlug",
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
      Brand.countDocuments({ isActive: { $ne: false } }),
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
    const [heroBanners, categories, sections, popularBrands, stats] = await Promise.all([
      this.getHeroBanners(),
      this.getCategories(),
      this.getSections(),
      this.getPopularBrands(),
      this.getHomepageStats(),
    ]);
    const row = (key) => sections.find((s) => s.key === key)?.products || [];

    return {
      heroBanners,
      categories,
      // The product rows, in the order set in the admin.
      sections,
      // The same built-in rows by name (for older versions of the website).
      featuredProducts: row("featured"),
      bestSellers: row("bestsellers"),
      newArrivals: row("new-arrivals"),
      trendingProducts: row("trending"),
      deals: row("deals"),
      popularBrands,
      stats,
    };
  }
}

module.exports = new HomepageService();