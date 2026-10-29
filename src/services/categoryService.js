const Category = require('../models/Category');
const Product = require('../models/Product');
const getCatalogImages = require('../utils/catalogImages');


class CategoryService {
  // Full category tree for website mega menu.
  // Same order as the Metro Sports menu (displayOrder), with product counts
  // so the website can hide empty categories.
  async getCategoryTree() {
    const [categories, images] = await Promise.all([
      Category.find({ isActive: { $ne: false } })
        .sort({ level: 1, displayOrder: 1, name: 1 })
        .lean(),
      getCatalogImages(),
    ]);

    const node = (category, children) => ({
      _id: category._id,
      name: category.name,
      slug: category.slug,
      level: category.level,
      productCount: category.productCount || 0,
      // a product photo from this category, for category tiles
      image: category.image || images.byCategory.get(category.slug) || "",
      ...(children ? { children } : {}),
    });

    const departments = categories.filter((c) => c.level === 1);
    const parents = categories.filter((c) => c.level === 2);
    const children = categories.filter((c) => c.level === 3);

    return departments.map((department) =>
      node(
        department,
        parents
          .filter((parent) => parent.parentSlug === department.slug)
          .map((parent) =>
            node(
              parent,
              children
                .filter((child) => child.parentSlug === parent.slug)
                .map((child) => node(child))
            )
          )
      )
    );
  }

  // Single category by slug
  async getCategoryBySlug(slug) {
    const category = await Category.findOne({ slug }).lean();

    if (!category) return null;

    const breadcrumb = [];

    if (category.rootSlug) {
      const root = await Category.findOne({ slug: category.rootSlug }).lean();
      if (root) breadcrumb.push({ name: root.name, slug: root.slug });
    }

    if (category.parentSlug && category.parentSlug !== category.rootSlug) {
      const parent = await Category.findOne({ slug: category.parentSlug }).lean();
      if (parent) breadcrumb.push({ name: parent.name, slug: parent.slug });
    }

    breadcrumb.push({
      name: category.name,
      slug: category.slug,
    });

    // Count products in this category (department, parent or child)
  const productCount = await Product.countDocuments({
    $or: [
      { department: category.slug },
      { parentCategory: category.slug },
      { childCategory: category.slug },
    ],
    visibility: "published",
    isActive: true,
  });

  // Count child categories
  const childrenCount = await Category.countDocuments({
    parentSlug: category.slug,
  });

    return {
      ...category,
      breadcrumb,
      productCount,
      childrenCount,
    };
  }
}

module.exports = new CategoryService();