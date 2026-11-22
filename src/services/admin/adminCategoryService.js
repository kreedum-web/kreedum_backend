const Category = require("../../models/Category");
const Product = require("../../models/Product");
const HttpError = require("../../utils/httpError");
const generateSlug = require("../../utils/generateSlug");
const { CATEGORY_LOCKABLE } = require("../../utils/adminCategories");

/**
 * Categories in the admin dashboard.
 *
 *   - create a category anywhere (top level, or under a category up to 3 levels)
 *   - rename, reorder, show / hide any category
 *   - delete only categories made in the admin, when they hold no products
 *     and no sub-categories (Metro's categories can be hidden instead)
 *
 * The catalogue rebuild (npm run rebuild:catalog) keeps all of this: admin-made
 * categories stay, and edits to Metro's categories are locked (adminLocked).
 */

const cleanName = (v) => {
  const name = String(v || "").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new HttpError(400, "Category name is too short.");
  if (name.length > 60) throw new HttpError(400, "Category name is too long (max 60 characters).");
  return name;
};

function item(c, counts) {
  const n = counts.get(c.slug) || { total: 0, live: 0 };
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    level: c.level,
    parentSlug: c.parentSlug || null,
    path: c.path || [c.slug],
    displayOrder: c.displayOrder || 0,
    isActive: c.isActive !== false,
    addedBy: c.addedBy || "",
    fromAdmin: c.addedBy === "admin",
    adminLocked: c.adminLocked || [],
    liveProducts: n.live,
    totalProducts: n.total,
  };
}

class AdminCategoryService {
  /** Every category, parents before children, with product counts. */
  async list() {
    const [categories, counts] = await Promise.all([
      Category.find({}).lean(),
      Product.aggregate([
        { $unwind: "$categoryPath" },
        {
          $group: {
            _id: "$categoryPath",
            total: { $sum: 1 },
            live: { $sum: { $cond: [{ $and: ["$isActive", { $eq: ["$visibility", "published"] }] }, 1, 0] } },
          },
        },
      ]),
    ]);
    const byId = new Map(counts.map((c) => [c._id, { total: c.total, live: c.live }]));
    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    // Sort by the menu: parent's order first, then the child's.
    const key = (c) =>
      (c.path || [c.slug]).map((slug) => {
        const node = bySlug.get(slug);
        return `${String(node?.displayOrder ?? 0).padStart(4, "0")}:${node?.name || slug}`;
      });
    const sorted = [...categories].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        if (ka[i] === undefined) return -1;
        if (kb[i] === undefined) return 1;
        const cmp = ka[i].localeCompare(kb[i]);
        if (cmp) return cmp;
      }
      return 0;
    });
    return sorted.map((c) => item(c, byId));
  }

  async #findOrFail(slug) {
    const category = await Category.findOne({ slug });
    if (!category) throw new HttpError(404, "Category not found.");
    return category;
  }

  /** body: { name, parentSlug (null/"" = top level), displayOrder? } */
  async create(body = {}) {
    const name = cleanName(body.name);
    const parentSlug = body.parentSlug ? String(body.parentSlug) : null;
    const parent = parentSlug ? await Category.findOne({ slug: parentSlug }).lean() : null;
    if (parentSlug && !parent) throw new HttpError(400, "Parent category not found.");
    const level = parent ? (parent.level || 1) + 1 : 1;
    if (level > 3) throw new HttpError(400, "Categories go 3 levels deep at most: pick a higher parent.");

    // Same name under the same parent = already there.
    const siblings = await Category.find(parent ? { parentSlug } : { level: 1 }).lean();
    if (siblings.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, `"${name}" already exists there.`);
    }

    const base = generateSlug(name) || "category";
    let slug = base;
    for (let n = 2; await Category.exists({ slug }); n++) slug = `${base}-${n}`;

    const displayOrder =
      body.displayOrder !== undefined && body.displayOrder !== ""
        ? Number(body.displayOrder) || 0
        : Math.max(-1, ...siblings.map((c) => c.displayOrder || 0)) + 1;

    const doc = await Category.create({
      name,
      slug,
      level,
      ...(parent ? { parentSlug: parent.slug } : {}),
      rootSlug: parent ? parent.rootSlug || parent.path?.[0] || parent.slug : slug,
      path: parent ? [...(parent.path || [parent.slug]), slug] : [slug],
      displayOrder,
      supplierCategories: [],
      isActive: true,
      addedBy: "admin",
      adminLocked: [],
      productCount: 0,
    });
    return (await this.list()).find((c) => c.slug === doc.slug);
  }

  /** body: { name?, displayOrder?, isActive? } */
  async update(slug, body = {}) {
    const category = await this.#findOrFail(slug);
    const changed = [];
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (name !== category.name) {
        category.name = name;
        changed.push("name");
      }
    }
    if (body.displayOrder !== undefined) {
      const order = Number(body.displayOrder) || 0;
      if (order !== category.displayOrder) {
        category.displayOrder = order;
        changed.push("displayOrder");
      }
    }
    if (body.isActive !== undefined) {
      const active = Boolean(body.isActive);
      if (active !== (category.isActive !== false)) {
        category.isActive = active;
        changed.push("isActive");
      }
    }
    if (changed.length) {
      category.adminLocked = [...new Set([...(category.adminLocked || []), ...changed.filter((f) => CATEGORY_LOCKABLE.includes(f))])];
      await category.save();
    }
    return (await this.list()).find((c) => c.slug === slug);
  }

  /** Only admin-made categories, empty and without sub-categories. */
  async remove(slug) {
    const category = await this.#findOrFail(slug);
    if (category.addedBy !== "admin") {
      throw new HttpError(400, "This category comes from the supplier's menu: hide it instead of deleting it.");
    }
    if (await Category.exists({ parentSlug: slug })) {
      throw new HttpError(409, "Delete or move its sub-categories first.");
    }
    const products = await Product.countDocuments({ categoryPath: slug });
    if (products) {
      throw new HttpError(409, `It still has ${products} product${products === 1 ? "" : "s"}: move them to another category first.`);
    }
    await Category.deleteOne({ _id: category._id });
    return { deleted: slug };
  }

  /** Forget the admin's edits on a supplier category (the next rebuild restores Metro's values). */
  async reset(slug) {
    const category = await this.#findOrFail(slug);
    category.adminLocked = [];
    await category.save();
    return (await this.list()).find((c) => c.slug === slug);
  }
}

module.exports = new AdminCategoryService();
