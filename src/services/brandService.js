const Brand = require('../models/Brand');
const Product = require('../models/Product');
const Category = require('../models/Category');
const getCatalogImages = require('../utils/catalogImages');

class BrandService {
  // Get all brands with product counts
  async getAllBrands() {
    const [brands, images] = await Promise.all([
      Brand.find({}).sort({ name: 1 }).lean(),
      getCatalogImages(),
    ]);

    const brandsWithCounts = await Promise.all(
      brands.map(async (brand) => {
        const productCount = await Product.countDocuments({
          brandSlug: brand.slug,
          visibility: 'published',
          isActive: true,
        });

        return {
          ...brand,
          productCount,
          // a product photo, for brand cards when there's no logo
          image: brand.logo || images.byBrand.get(brand.slug) || '',
        };
      })
    );

    return brandsWithCounts;
  }

  // Get brand by slug
  async getBrandBySlug(slug) {
    const brand = await Brand.findOne({ slug }).lean();

    if (!brand) return null;

    const stats = {
      totalProducts: await Product.countDocuments({
        brandSlug: slug,
        visibility: 'published',
        isActive: true,
      }),

      featuredProducts: await Product.countDocuments({
        brandSlug: slug,
        isFeatured: true,
        visibility: 'published',
        isActive: true,
      }),

      bestSellers: await Product.countDocuments({
        brandSlug: slug,
        isBestSeller: true,
        visibility: 'published',
        isActive: true,
      }),
    };

    // Which departments / categories this brand has products in, with counts,
    // in the website menu order — for the brand page's category filter.
    const [products, categoryDocs] = await Promise.all([
      Product.find(
        { brandSlug: slug, visibility: 'published', isActive: true },
        { department: 1, parentCategory: 1 }
      ).lean(),
      Category.find({ level: { $in: [1, 2] } }, { slug: 1, name: 1, level: 1, displayOrder: 1 }).lean(),
    ]);

    const info = new Map(categoryDocs.map((c) => [c.slug, c]));
    const departments = new Map();

    for (const product of products) {
      if (!info.has(product.department)) continue;
      if (!departments.has(product.department)) {
        departments.set(product.department, { productCount: 0, categories: new Map() });
      }
      const dept = departments.get(product.department);
      dept.productCount++;
      if (info.has(product.parentCategory)) {
        dept.categories.set(product.parentCategory, (dept.categories.get(product.parentCategory) || 0) + 1);
      }
    }

    const byMenuOrder = (a, b) => (info.get(a.slug).displayOrder || 0) - (info.get(b.slug).displayOrder || 0);

    const categories = [...departments]
      .map(([deptSlug, dept]) => ({
        slug: deptSlug,
        name: info.get(deptSlug).name,
        productCount: dept.productCount,
        children: [...dept.categories]
          .map(([catSlug, productCount]) => ({ slug: catSlug, name: info.get(catSlug).name, productCount }))
          .sort(byMenuOrder),
      }))
      .sort(byMenuOrder);

    const images = await getCatalogImages();

    return {
      ...brand,
      image: brand.logo || images.byBrand.get(brand.slug) || '',
      stats,
      categories,
    };
  }

  // Products by brand
  async getBrandProducts(slug, query) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 12;
    const skip = (page - 1) * limit;

    const filter = {
      brandSlug: slug,
      visibility: 'published',
      isActive: true,
    };

    if (query.department) filter.department = query.department;

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
      featured: { isFeatured: -1, displayOrder: 1 },
      popular: { isBestSeller: -1, createdAt: -1 },
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

module.exports = new BrandService();