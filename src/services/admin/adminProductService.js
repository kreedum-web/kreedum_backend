const mongoose = require("mongoose");

const Product = require("../../models/Product");
const Brand = require("../../models/Brand");
const Category = require("../../models/Category");
const generateSlug = require("../../utils/generateSlug");
const { searchKeywordsFor } = require("../../utils/searchKeywords");
const HttpError = require("../../utils/httpError");
const { uploadImage } = require("../../utils/cloudinaryFolders");
const extractSpecifications = require("../../utils/extractSpecifications");
const { reconcileVisibility, recountProducts, refreshVisibility, visibilityContext } = require("../../utils/productVisibility");
const { clearCache: clearHomeCache } = require("../homeSectionsService");

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
 *
 * Products can also be added by hand (supplier "manual"). No supplier feed
 * has them, so the catalogue rebuild never changes or hides them, and their
 * description, features and SKU can be edited here too.
 */

const MANUAL = "manual";
const isManual = (p) => p.supplier === MANUAL;

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
  readyStock: Boolean, // in our store: fastest delivery (home page "Ready Stock" row)
  badge: (v) => oneOf(v, ["", "Best Seller", "New Arrival", "Trending", "Hot Deal"], "badge"),
  displayOrder: (v) => Number(v) || 0,
};

// Fields the catalogue rebuild writes; changing them locks them.
const REBUILD_FIELDS = [
  "name", "mrp", "sellingPrice", "discountPercent", "maxPrice", "variants",
  "isActive", "visibility", "hiddenBy", "images", "thumbnail",
  "brand", "brandSlug", "categoryPath", "department", "parentCategory", "childCategory",
];

// Extra fields for products added by hand (the rebuild doesn't write them for
// those, so they need no lock).
const MANUAL_EDITABLE = {
  sku: (v) => String(v || "").trim().slice(0, 60),
  descriptionText: (v) => String(v || "").trim().slice(0, 5000),
  features: (v) => linesOf(v),
};

/** "Motor: 2 HP\nFoldable" or ["Motor: 2 HP", "Foldable"] -> ["Motor: 2 HP", "Foldable"] */
function linesOf(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split("\n");
  return lines.map((l) => String(l).replace(/^[\s•*-]+/, "").trim()).filter(Boolean).slice(0, 40).map((l) => l.slice(0, 200));
}

/** Specification boxes on the product page come from "Name: value" feature lines, as for supplier products. */
function applyFeatures(product) {
  const { specifications, highlights } = extractSpecifications(product.features || []);
  product.specifications = specifications;
  product.highlights = highlights;
  product.warranty = specifications.Warranty || "";
  product.maxUserWeight = specifications["Max User Weight"] || "";
  product.dimensions = specifications.Dimensions || "";
  product.weight = specifications.Weight || "";
}

function seoFor(product) {
  const text = String(product.descriptionText || "").replace(/\s+/g, " ").trim();
  return {
    title: `${product.name} | Kreedum Sports Lucknow`,
    description: (text.length > 160 ? `${text.slice(0, 157)}...` : text) || `${product.name} available at Kreedum Sports Lucknow.`,
    keywords: product.searchKeywords || [],
  };
}

async function uniqueProductSlug(name, sku) {
  const base = sku ? `${generateSlug(name)}-${generateSlug(sku)}` : generateSlug(name);
  let slug = base || `product-${Date.now()}`;
  for (let n = 2; await Product.exists({ slug }); n++) slug = `${base}-${n}`;
  return slug;
}

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
    manual: isManual(p),
    readyStock: Boolean(p.readyStock),
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
    // $set isActive: a brand the last rebuild switched off for having no products is back.
    if (now.brandSlug) {
      ops.push(Brand.updateOne({ slug: now.brandSlug }, { $inc: { productCount: 1 } }));
      ops.push(Brand.updateOne({ slug: now.brandSlug, adminHidden: { $ne: true } }, { $set: { isActive: true } }));
    }
  }
  await Promise.all(ops);
}

/** The Products page filters as a MongoDB query (list and bulk actions). */
const FILTER_KEYS = ["q", "brand", "department", "category", "state", "stock", "highlight"];
// ?highlight= : products ticked for a home page row
const HIGHLIGHTS = {
  featured: "isFeatured",
  bestseller: "isBestSeller",
  new: "isNewArrival",
  trending: "isTrending",
  "ready-stock": "readyStock",
};
function productFilter({ q = "", brand = "", department = "", category = "", state = "", stock = "", highlight = "" } = {}) {
  const filter = {};
  const text = String(q || "").trim();
  if (text) {
    const pattern = new RegExp(escapeRegex(text), "i");
    filter.$or = [{ name: pattern }, { sku: pattern }, { brand: pattern }];
  }
  if (brand) filter.brandSlug = String(brand);
  if (department) filter.department = String(department);
  if (category) filter.categoryPath = String(category); // that category or anything inside it
  if (stock) filter.stockStatus = String(stock);
  if (state === "live") Object.assign(filter, { isActive: true, visibility: "published" });
  if (state === "hidden") filter.$and = [{ $or: [{ isActive: false }, { visibility: { $ne: "published" } }] }];
  if (state === "locked") filter["adminLocked.0"] = { $exists: true };
  if (HIGHLIGHTS[highlight]) filter[HIGHLIGHTS[highlight]] = true;
  return filter;
}

const LIVE_FIELDS = ["isActive", "visibility", "hiddenBy"];

class AdminProductService {
  /**
   * @param {{ q?: string, brand?: string, department?: string, category?: string, state?: "live"|"hidden"|"locked", stock?: string, page?: number }} filters
   */
  async list({ page = 1, limit = 25, ...filters } = {}) {
    const filter = productFilter(filters);

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

  /**
   * Show or hide every product matching the Products page filters (all
   * pages), like its own On website switch would.
   *   hide: live products are switched off by hand ("admin").
   *   show: products switched off by hand come back; those whose category or
   *         brand is off stay hidden until it's on again. Products the
   *         catalogue sync hid (gone from the supplier, no category) are
   *         left alone: open them one by one for those.
   * @param {{ filters: object, live: boolean, dryRun?: boolean }} body
   * dryRun: only count what would change (for the confirm box).
   */
  /**
   * Mark (or unmark) every product matching the filters as ready stock.
   * dryRun: only count.
   */
  async bulkSetReadyStock({ filters = {}, readyStock, dryRun = false } = {}) {
    if (typeof readyStock !== "boolean") throw new HttpError(400, "Say whether to mark (readyStock: true) or unmark (false).");
    if (!FILTER_KEYS.some((k) => String(filters[k] || "").trim())) {
      throw new HttpError(400, "Choose at least one filter first (brand, category, search…), so this can't change the whole catalogue by mistake.");
    }
    const query = productFilter(filters);
    const [matched, already] = await Promise.all([
      Product.countDocuments(query),
      Product.countDocuments({ ...query, readyStock: readyStock ? true : { $ne: true } }),
    ]);
    if (!dryRun && matched > already) {
      await Product.updateMany(query, { $set: { readyStock } });
      clearHomeCache();
    }
    return { matched, changed: matched - already, already, dryRun };
  }

  async bulkSetLive({ filters = {}, live, dryRun = false } = {}) {
    if (typeof live !== "boolean") throw new HttpError(400, "Say whether to show (live: true) or hide (live: false).");
    if (!FILTER_KEYS.some((k) => String(filters[k] || "").trim())) {
      throw new HttpError(400, "Choose at least one filter first (brand, category, search…), so this can't change the whole catalogue by mistake.");
    }
    const products = await Product.find(productFilter(filters), {
      supplier: 1, brandSlug: 1, categoryPath: 1, isActive: 1, visibility: 1, hiddenBy: 1, adminLocked: 1,
    }).lean();
    const context = live ? await visibilityContext() : null;

    const result = {
      matched: products.length,
      changed: 0, // shown / hidden now
      already: 0, // already shown / hidden
      waiting: 0, // show: stays hidden until its category / brand is on (then it comes back)
      bySync: 0, // show: hidden by the catalogue sync, left alone
    };
    const writes = [];
    for (const p of products) {
      const wasLive = isLive(p);
      if (live === wasLive) {
        result.already++;
        continue;
      }
      const next = { isActive: p.isActive, visibility: p.visibility, hiddenBy: p.hiddenBy };
      if (!live) {
        Object.assign(next, { isActive: false, visibility: "hidden", hiddenBy: "admin" });
        result.changed++;
      } else if (p.hiddenBy === "admin") {
        // On, unless its category / brand is off: then hidden for that reason.
        const after = { ...p, isActive: true, visibility: "published", hiddenBy: "" };
        reconcileVisibility(after, context);
        Object.assign(next, { isActive: after.isActive, visibility: after.visibility, hiddenBy: after.hiddenBy });
        if (isLive(next)) result.changed++;
        else result.waiting++;
      } else if (["admin-category", "admin-brand", "brand-rule"].includes(p.hiddenBy)) {
        result.waiting++; // nothing to do: it follows its category / brand
        continue;
      } else {
        result.bySync++;
        continue;
      }
      const update = { $set: next };
      // Kept as set here when the catalogue syncs (products added by hand have no supplier values).
      if (!isManual(p)) update.$addToSet = { adminLocked: { $each: LIVE_FIELDS } };
      writes.push({ updateOne: { filter: { _id: p._id }, update } });
    }

    if (!dryRun && writes.length) {
      await Product.bulkWrite(writes);
      await recountProducts();
      clearHomeCache();
    }
    return { ...result, dryRun };
  }

  async get(productId) {
    checkId(productId);
    const product = await Product.findById(productId).lean();
    if (!product) throw new HttpError(404, "Product not found.");
    return { ...listItem(product), images: product.images || [], variants: product.variants || [],
      availabilityMessage: product.availabilityMessage, isFeatured: product.isFeatured,
      isBestSeller: product.isBestSeller, isNewArrival: product.isNewArrival, isTrending: product.isTrending,
      readyStock: Boolean(product.readyStock),
      badge: product.badge, displayOrder: product.displayOrder, visibility: product.visibility,
      isActive: product.isActive, hiddenBy: product.hiddenBy, sourceUrl: product.sourceUrl,
      categoryPath: product.categoryPath || [], brandSlug: product.brandSlug, supplier: product.supplier,
      manual: isManual(product), descriptionText: product.descriptionText || "", features: product.features || [],
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

    if (isManual(product)) {
      for (const [field, clean] of Object.entries(MANUAL_EDITABLE)) {
        if (body[field] === undefined) continue;
        const value = clean(body[field]);
        if (JSON.stringify(product[field] ?? "") !== JSON.stringify(value)) {
          product[field] = value;
          changed.add(field);
        }
      }
      if (changed.has("features")) applyFeatures(product);
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

    // A hidden brand or category keeps the product hidden (even if switched on
    // here); one hidden only because of its old brand / category comes back.
    if (reconcileVisibility(product, await visibilityContext())) {
      ["isActive", "visibility", "hiddenBy"].forEach((f) => changed.add(f));
    }

    if (["brand", "categoryPath", "name", "sku"].some((f) => changed.has(f))) {
      const categories = await Category.find({ slug: { $in: product.categoryPath || [] } }, { slug: 1, name: 1 }).lean();
      product.searchKeywords = searchKeywordsFor(product, new Map(categories.map((c) => [c.slug, c])));
    }
    if (isManual(product) && ["name", "descriptionText", "brand", "categoryPath"].some((f) => changed.has(f))) {
      product.seo = seoFor(product);
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

    // Products added by hand have no supplier values to protect: no locks.
    if (!isManual(product)) {
      const locks = new Set(product.adminLocked || []);
      for (const field of changed) if (REBUILD_FIELDS.includes(field)) locks.add(field);
      product.adminLocked = [...locks];
    }

    await product.save();
    clearHomeCache(); // home page rows show the change straight away
    await updateCounts(before, { path: product.categoryPath || [], brandSlug: product.brandSlug, live: isLive(product) });
    return this.get(productId);
  }

  /**
   * Add a product by hand.
   * body: { name, brand, categorySlug, sellingPrice?, mrp?, stockStatus?, availabilityMessage?,
   *         sku?, descriptionText?, features? (lines), live? }
   * No price (0) = "Price on enquiry". Photos are added afterwards with addImage.
   */
  async create(body = {}) {
    const name = EDITABLE.name(body.name);
    if (!body.brand) throw new HttpError(400, "Choose or type a brand.");
    if (!body.categorySlug) throw new HttpError(400, "Choose a category.");
    const sku = MANUAL_EDITABLE.sku(body.sku);
    const sellingPrice = body.sellingPrice === undefined || body.sellingPrice === "" ? 0 : price(body.sellingPrice, "Selling price");
    const mrpInput = body.mrp === undefined || body.mrp === "" ? 0 : price(body.mrp, "MRP");
    const mrp = Math.max(mrpInput, sellingPrice);
    const stockStatus = sellingPrice
      ? EDITABLE.stockStatus(body.stockStatus || "in_stock")
      : "enquiry_only"; // no price: customers enquire

    const product = await Product.create({
      supplier: MANUAL,
      sourceUrl: "",
      name,
      slug: await uniqueProductSlug(name, sku),
      sku,
      brand: "-", // set just below, with the brand checks
      brandSlug: "-",
      mrp,
      sellingPrice,
      discountPercent: discountOf(mrp, sellingPrice),
      maxPrice: sellingPrice,
      stockStatus,
      availabilityMessage: EDITABLE.availabilityMessage(body.availabilityMessage) || "Contact Kreedum Sports for product availability.",
      descriptionText: MANUAL_EDITABLE.descriptionText(body.descriptionText),
      features: MANUAL_EDITABLE.features(body.features),
      isActive: false, // counted in when it goes live below
      visibility: "hidden",
      hiddenBy: "admin",
      lastSyncedAt: new Date(),
    });
    try {
      applyFeatures(product);
      await product.save();
    clearHomeCache(); // home page rows show the change straight away
      // Brand, category, search words, SEO and on/off go through the normal edit.
      return await this.update(String(product._id), {
        brand: body.brand,
        categorySlug: body.categorySlug,
        live: body.live !== false,
      });
    } catch (error) {
      await Product.deleteOne({ _id: product._id }); // bad brand / category: nothing half-made
      throw error;
    }
  }

  /** Delete a product added by hand. Supplier products can only be hidden. */
  async remove(productId) {
    checkId(productId);
    const product = await Product.findById(productId);
    if (!product) throw new HttpError(404, "Product not found.");
    if (!isManual(product)) {
      throw new HttpError(400, "Only products added here can be deleted. Hide this one instead.");
    }
    await Product.deleteOne({ _id: product._id });
    await updateCounts({ path: product.categoryPath || [], brandSlug: product.brandSlug, live: isLive(product) }, { path: [], brandSlug: null, live: false });
    return { deleted: true };
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
    if (!isManual(product)) product.adminLocked = [...new Set([...(product.adminLocked || []), "images", "thumbnail"])];
    await product.save();
    clearHomeCache(); // home page rows show the change straight away
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
      await brand.save();
      // Its products follow (except those switched off on their own page, or
      // in a hidden category); product counts are worked out again.
      await refreshVisibility({ brandSlug: slug });
      return (await this.listBrands()).find((b) => b.slug === slug);
    }

    await brand.save();
    return (await this.listBrands()).find((b) => b.slug === slug);
  }
}

module.exports = new AdminProductService();
module.exports.REBUILD_FIELDS = REBUILD_FIELDS;
