const mongoose = require("mongoose");

const Product = require("../../models/Product");
const Brand = require("../../models/Brand");
const Category = require("../../models/Category");
const generateSlug = require("../../utils/generateSlug");
const { isHiddenBrand } = require("../../utils/brandRules");
const { searchKeywordsFor } = require("../../utils/searchKeywords");
const HttpError = require("../../utils/httpError");
const { uploadImage } = require("../../utils/cloudinaryFolders");

/**
 * Products and brands in the admin dashboard.
 *
 * Every field the admin changes is added to product.adminLocked, and the
 * catalogue rebuild (npm run rebuild:catalog) leaves locked fields alone, so
 * an admin's price, name, photos or on/off choice survives the next Metro
 * sync. "Reset to supplier" clears the locks; the next rebuild then brings
 * back Metro's values.
 *
 * Brand and category can be changed too (also locked): the rebuild then
 * builds the product with the admin's brand and category.
 */

// Fields the admin may change, and the cleaner for each.
const EDITABLE = {
  name: (v) => {
    const name = String(v || "").trim();
    if (name.length < 3) throw new HttpError(400, "Product name is too short.");
    return name.slice(0, 200);
  },
  sellingPrice: (v) => price(v, "Selling price"),
  mrp: (v) => price(v, "MRP"),
  stockStatus: (v) => oneOf(v, ["in_stock", "out_of_stock", "enquiry_only", "preorder"], "stock status"),
  availabilityMessage: (v) => String(v || "").trim().slice(0, 200),
  isFeatured: Boolean,
  isBestSeller: Boolean,
  isNewArrival: Boolean,
  isTrending: Boolean,
  badge: (v) => oneOf(v, ["", "Best Seller", "New Arrival", "Trending", "Hot Deal"], "badge"),
  displayOrder: (v) => Number(v) || 0,
};

// Fields the catalogue rebuild writes; changing them locks them.
const REBUILD_FIELDS = [
  "name", "mrp", "sellingPrice", "discountPercent", "maxPrice", "variants",
  "isActive", "visibility", "hiddenBy", "images", "thumbnail",
  "brand", "brandSlug", "categoryPath", "department", "parentCategory", "childCategory",
];

function price(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, `${label} must be a number.`);
  return Math.round(number);
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `Unknown ${label}.`);
  return value;
}

const discountOf = (mrp, sellingPrice) =>
  mrp > sellingPrice && sellingPrice > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isLive = (p) => p.isActive && p.visibility === "published";

function listItem(p) {
  return {
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    brand: p.brand,
    brandSlug: p.brandSlug,
    department: p.department,
    categoryPath: p.categoryPath || [],
    thumbnail: p.thumbnail || p.images?.[0] || "",
    sellingPrice: p.sellingPrice,
    mrp: p.mrp,
    maxPrice: p.maxPrice,
    variantCount: (p.variants || []).length,
    stockStatus: p.stockStatus,
    live: isLive(p),
    adminLocked: p.adminLocked || [],
  };
}

function checkId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid product id.");
}

/** Accept a picture sent from the dashboard (data:image/…;base64,…, max ~8 MB). */
function checkImageData(data) {
  if (typeof data !== "string" || !/^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(data)) {
    throw new HttpError(400, "Please choose a JPG, PNG or WebP picture.");
  }
  if (data.length > 11 * 1024 * 1024) throw new HttpError(413, "Picture is too big (max 8 MB).");
  return data;
}

/**
 * Keep the menu's product counts right after a product changes category,
 * brand or on/off (the next rebuild recounts everything anyway).
 */
async function updateCounts(before, after) {
  const was = before.live ? before : { path: [], brandSlug: null };
  const now = after.live ? after : { path: [], brandSlug: null };
  const out = was.path.filter((slug) => !now.path.includes(slug));
  const into = now.path.filter((slug) => !was.path.includes(slug));
  const ops = [];
  if (out.length) ops.push(Category.updateMany({ slug: { $in: out } }, { $inc: { productCount: -1 } }));
  if (into.length) ops.push(Category.updateMany({ slug: { $in: into } }, { $inc: { productCount: 1 } }));
  if (was.brandSlug !== now.brandSlug) {
    if (was.brandSlug) ops.push(Brand.updateOne({ slug: was.brandSlug }, { $inc: { productCount: -1 } }));
    if (now.brandSlug) ops.push(Brand.updateOne({ slug: now.brandSlug }, { $inc: { productCount: 1 } }));
  }
  await Promise.all(ops);
}

class AdminProductService {
  /**
   * @param {{ q?: string, brand?: string, department?: string, category?: string, state?: "live"|"hidden"|"locked", stock?: string, page?: number }} filters
   */
  async list({ q = "", brand = "", department = "", category = "", state = "", stock = "", page = 1, limit = 25 } = {}) {
    const filter = {};
    const text = String(q || "").trim();
    if (text) {
      const pattern = new RegExp(escapeRegex(text), "i");
      filter.$or = [{ name: pattern }, { sku: pattern }, { brand: pattern }];
    }
    if (brand) filter.brandSlug = brand;
    if (department) filter.department = department;
    if (category) filter.categoryPath = String(category); // that category or anything inside it
    if (stock) filter.stockStatus = stock;
    if (state === "live") Object.assign(filter, { isActive: true, visibility: "published" });
    if (state === "hidden") filter.$and = [{ $or: [{ isActive: false }, { visibility: { $ne: "published" } }] }];
    if (state === "locked") filter["adminLocked.0"] = { $exists: true };

    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const [products, total, departments] = await Promise.all([
      Product.find(filter).sort({ updatedAt: -1 }).skip((current - 1) * size).limit(size).lean(),
      Product.countDocuments(filter),
      Product.distinct("department"),
    ]);
    return {
      products: products.map(listItem),
      page: current,
      pages: Math.max(Math.ceil(total / size), 1),
      total,
      departments: departments.filter(Boolean).sort(),
    };
  }

  async get(productId) {
    checkId(productId);
    const product = await Product.findById(productId).lean();
    if (!product) throw new HttpError(404, "Product not found.");
    return { ...listItem(product), images: product.images || [], variants: product.variants || [],
      availabilityMessage: product.availabilityMessage, isFeatured: product.isFeatured,
      isBestSeller: product.isBestSeller, isNewArrival: product.isNewArrival, isTrending: product.isTrending,
      badge: product.badge, displayOrder: product.displayOrder, visibility: product.visibility,
      isActive: product.isActive, hiddenBy: product.hiddenBy, sourceUrl: product.sourceUrl,
      categoryPath: product.categoryPath || [], brandSlug: product.brandSlug, supplier: product.supplier,
      updatedAt: product.updatedAt };
  }

  /**
   * Save the admin's changes.
   * body: any EDITABLE field, plus
   *   live: true/false              show on / hide from the website
   *   variants: [{ variantId, sellingPrice, mrp, inStock }]   per-option prices / stock
   *   images: [url, …]              new photo order (first = main photo); only urls the product already has
   */
  async update(productId, body = {}) {
    checkId(productId);
    const product = await Product.findById(productId);
    if (!product) throw new HttpError(404, "Product not found.");

    const changed = new Set();
    const before = { path: [...(product.categoryPath || [])], brandSlug: product.brandSlug, live: isLive(product) };
    for (const [field, clean] of Object.entries(EDITABLE)) {
      if (body[field] === undefined) continue;
      const value = clean(body[field]);
      if (product[field] !== value) {
        product[field] = value;
        changed.add(field);
      }
    }

    if (body.live !== undefined) {
      const live = Boolean(body.live);
      if (live !== isLive(product)) {
        product.isActive = live;
        product.visibility = live ? "published" : "hidden";
        product.hiddenBy = live ? "" : "admin";
        ["isActive", "visibility", "hiddenBy"].forEach((f) => changed.add(f));
      }
    }

    // ---- brand: { brand: "Kreedum" } (an existing brand, or a new one)
    if (body.brand !== undefined) {
      const name = String(body.brand || "").replace(/\s+/g, " ").trim();
      if (name.length < 2 || name.length > 60) throw new HttpError(400, "Brand name must be 2–60 characters.");
      const slug = generateSlug(name);
      const known = await Brand.findOne({ slug }).lean();
      const brandName = known?.name || name;
      if (product.brandSlug !== slug || product.brand !== brandName) {
        product.brand = brandName;
        product.brandSlug = slug;
        changed.add("brand").add("brandSlug");
        if (!known) await Brand.create({ name: brandName, slug, isActive: true, productCount: 0 }).catch(() => {});
        // Brand switched off (admin) or not sold (brandRules.js): the product follows.
        if (known?.adminHidden) {
          Object.assign(product, { isActive: false, visibility: "hidden", hiddenBy: "admin-brand" });
          ["isActive", "visibility", "hiddenBy"].forEach((f) => changed.add(f));
        } else if (isHiddenBrand(slug)) {
          Object.assign(product, { isActive: false, visibility: "hidden", hiddenBy: "brand-rule" });
          ["isActive", "visibility", "hiddenBy"].forEach((f) => changed.add(f));
        } else if (["admin-brand", "brand-rule"].includes(product.hiddenBy)) {
          // It was hidden only because of its old brand.
          Object.assign(product, { isActive: true, visibility: "published", hiddenBy: "" });
          ["isActive", "visibility", "hiddenBy"].forEach((f) => changed.add(f));
        }
      }
    }

    // ---- category: { categorySlug: "walking-pads" } (any category, any level)
    if (body.categorySlug !== undefined) {
      const category = await Category.findOne({ slug: String(body.categorySlug || "") }).lean();
      if (!category) throw new HttpError(400, "Category not found.");
      const path = category.path?.length ? category.path : [category.slug];
      if (JSON.stringify(path) !== JSON.stringify(product.categoryPath || [])) {
        product.categoryPath = path;
        product.department = path[0] || "";
        product.parentCategory = path[1] || "";
        product.childCategory = path[2] || "";
        ["categoryPath", "department", "parentCategory", "childCategory"].forEach((f) => changed.add(f));
      }
    }

    if (changed.has("brand") || changed.has("categoryPath")) {
      const categories = await Category.find({ slug: { $in: product.categoryPath || [] } }, { slug: 1, name: 1 }).lean();
      product.searchKeywords = searchKeywordsFor(product, new Map(categories.map((c) => [c.slug, c])));
    }

    if (Array.isArray(body.variants) && product.variants?.length) {
      const edits = new Map(body.variants.map((v) => [String(v.variantId), v]));
      let touched = false;
      product.variants = product.variants.map((variant) => {
        const edit = edits.get(variant.variantId);
        if (!edit) return variant;
        const next = variant.toObject ? variant.toObject() : { ...variant };
        if (edit.sellingPrice !== undefined) next.sellingPrice = price(edit.sellingPrice, "Option price");
        if (edit.mrp !== undefined) next.mrp = price(edit.mrp, "Option MRP");
        if (edit.inStock !== undefined) next.inStock = Boolean(edit.inStock);
        touched = touched || JSON.stringify(next) !== JSON.stringify(variant.toObject ? variant.toObject() : variant);
        return next;
      });
      if (touched) {
        // The product's own price is its cheapest option ("from ₹…").
        const cheapest = [...product.variants].sort((a, b) => a.sellingPrice - b.sellingPrice)[0];
        product.sellingPrice = cheapest.sellingPrice;
        product.mrp = Math.max(cheapest.mrp || 0, cheapest.sellingPrice);
        product.maxPrice = Math.max(...product.variants.map((v) => v.sellingPrice));
        ["variants", "sellingPrice", "mrp", "maxPrice"].forEach((f) => changed.add(f));
      }
    }

    if (Array.isArray(body.images)) {
      const known = new Set(product.images || []);
      const images = body.images.map(String).filter((url) => known.has(url));
      if (!images.length) throw new HttpError(400, "A product needs at least one photo.");
      if (JSON.stringify(images) !== JSON.stringify(product.images)) {
        product.images = images;
        product.thumbnail = images[0];
        changed.add("images").add("thumbnail");
      }
    }

    if (changed.has("sellingPrice") || changed.has("mrp")) {
      if (product.mrp && product.mrp < product.sellingPrice) product.mrp = product.sellingPrice;
      product.discountPercent = discountOf(product.mrp, product.sellingPrice);
      if (!product.variants?.length) product.maxPrice = product.sellingPrice;
      ["mrp", "discountPercent", "maxPrice"].forEach((f) => changed.add(f));
    }

    if (!changed.size) return this.get(productId);

    const locks = new Set(product.adminLocked || []);
    for (const field of changed) if (REBUILD_FIELDS.includes(field)) locks.add(field);
    product.adminLocked = [...locks];

    await product.save();
    await updateCounts(before, { path: product.categoryPath || [], brandSlug: product.brandSlug, live: isLive(product) });
    return this.get(productId);
  }

  /** Add a photo (uploaded to Cloudinary kreedum/products). */
  async addImage(productId, { data, makeMain = false } = {}) {
    checkId(productId);
    const product = await Product.findById(productId);
    if (!product) throw new HttpError(404, "Product not found.");

    const { url } = await uploadImage(checkImageData(data), {
      kind: "products",
      name: `${product.slug}-admin-${Date.now()}`,
    });
    product.images = makeMain ? [url, ...(product.images || [])] : [...(product.images || []), url];
    product.thumbnail = product.images[0];
    product.adminLocked = [...new Set([...(product.adminLocked || []), "images", "thumbnail"])];
    await product.save();
    return this.get(productId);
  }

  /** Forget the admin's changes: the next catalogue rebuild restores Metro's values. */
  async resetToSupplier(productId) {
    checkId(productId);
    const result = await Product.updateOne({ _id: productId }, { $set: { adminLocked: [] } });
    if (!result.matchedCount) throw new HttpError(404, "Product not found.");
    return this.get(productId);
  }

  // ---------------------------------------------------------------- brands

  async listBrands() {
    const [brands, counts] = await Promise.all([
      Brand.find({}).sort({ name: 1 }).lean(),
      Product.aggregate([{ $group: { _id: "$brandSlug", total: { $sum: 1 } } }]),
    ]);
    const totals = new Map(counts.map((c) => [c._id, c.total]));
    return brands.map((b) => ({
      id: String(b._id),
      name: b.name,
      slug: b.slug,
      logo: b.logo,
      description: b.description || "",
      featured: Boolean(b.featured),
      live: b.isActive !== false && !b.adminHidden,
      adminHidden: Boolean(b.adminHidden),
      liveProducts: b.productCount || 0,
      totalProducts: totals.get(b.slug) || 0,
    }));
  }

  /**
   * body: { description?, featured?, live?, logo? (data:image/… to upload) }
   * live:false hides the brand and every product of it (hiddenBy "admin-brand");
   * live:true shows them again (only those this switch hid).
   */
  async updateBrand(slug, body = {}) {
    const brand = await Brand.findOne({ slug });
    if (!brand) throw new HttpError(404, "Brand not found.");

    if (body.description !== undefined) brand.description = String(body.description || "").trim().slice(0, 1000);
    if (body.featured !== undefined) brand.featured = Boolean(body.featured);
    if (body.logo) {
      const { url, publicId } = await uploadImage(checkImageData(body.logo), { kind: "brands", name: brand.slug, overwrite: true });
      brand.logo = url;
      brand.logoPublicId = publicId;
    }

    if (body.live !== undefined) {
      const live = Boolean(body.live);
      brand.adminHidden = !live;
      brand.isActive = live;
      if (live) {
        await Product.updateMany(
          { brandSlug: slug, hiddenBy: "admin-brand" },
          { $set: { isActive: true, visibility: "published", hiddenBy: "" } }
        );
        brand.productCount = await Product.countDocuments({ brandSlug: slug, isActive: true, visibility: "published" });
      } else {
        await Product.updateMany(
          { brandSlug: slug, isActive: true, visibility: "published" },
          { $set: { isActive: false, visibility: "hidden", hiddenBy: "admin-brand" } }
        );
        brand.productCount = 0;
      }
    }

    await brand.save();
    return (await this.listBrands()).find((b) => b.slug === slug);
  }
}

module.exports = new AdminProductService();
module.exports.REBUILD_FIELDS = REBUILD_FIELDS;
