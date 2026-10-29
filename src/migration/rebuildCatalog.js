/**
 * Rebuild the website catalogue (KreedumCommerce) from the scraped
 * Metro Sports data (kreedum_supplier_sync), in one go:
 *
 *   1. categories  — Metro's menu tree, exactly as on metrosports.co.in
 *   2. products    — department / parentCategory / childCategory from that same tree
 *   3. brands      — from the products, with real product counts
 *
 * Replaces running migrate:categories, migrate:products, migrate:normalize-brands,
 * migrate:brands and migrate:enrich-products one after another.
 *
 *   npm run rebuild:catalog              dry run: prints what would change, writes nothing
 *   npm run rebuild:catalog -- --apply   writes the changes
 *
 * Safe for a live site:
 *   - products are matched by sourceUrl and updated in place, so their _id
 *     (used by carts, wishlists and orders) never changes
 *   - marketing and analytics fields are never overwritten: isFeatured,
 *     isBestSeller, isNewArrival, isTrending, badge, displayOrder, viewCount,
 *     enquiryCount, popularityScore, stockStatus, availabilityMessage
 *   - brand logo / description / featured are kept
 *   - products that disappeared from Metro are hidden, never deleted
 *   - categories that are not in Metro's menu ARE deleted (they are generated
 *     data); the dry run lists them first
 *
 * Needs the scraper's category tree: run `npm run categories` in the scraper first.
 */
require("../config/bootstrap");

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const connectDatabase = require("../config/database");
const connectSupplierDatabase = require("../config/supplierDatabase");

const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");

const generateSlug = require("../utils/generateSlug");
const generateKeywords = require("../utils/generateKeywords");
const extractSpecifications = require("../utils/extractSpecifications");

const SUPPLIER = "metrosports";
const DEFAULT_AVAILABILITY = "Contact Kreedum Sports for product availability.";

// ===================================================================
// PURE PLANNING (no database) — exported for testing
// ===================================================================

/** Meta description: up to ~160 characters, cut at a sentence or word, never mid-word. */
function seoDescription(text = "") {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= 160) return clean;
  const sentenceEnd = clean.slice(0, 160).search(/[.!?][^.!?]*$/);
  if (sentenceEnd > 80) return clean.slice(0, sentenceEnd + 1);
  const cut = clean.slice(0, 157);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

const leafSlug = (slug = "") => String(slug || "").replace(/\/+$/, "").split("/").pop();

function buildCategoryDocs(supplierCategories) {
  return supplierCategories
    .filter((node) => node.isActive !== false && node.level)
    .sort((a, b) => a.level - b.level || a.displayOrder - b.displayOrder)
    .map((node) => ({
      name: node.name,
      slug: node.slug,
      level: node.level,
      parentSlug: node.parentSlug || undefined,
      rootSlug: node.rootSlug || node.path?.[0] || node.slug,
      path: node.path,
      displayOrder: node.displayOrder || 0,
      supplierCategories: [node.sourceSlug || node.slug],
      isActive: true,
    }));
}

function uniqueSlug(base, url, used) {
  let slug = base || "product";
  if (used.has(slug)) {
    const urlSlug = generateSlug(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    slug = `${slug}-${urlSlug}`;
  }
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/**
 * @param {object} sp       supplier product (kreedum_supplier_sync.products)
 * @param {Map} tree        slug -> category node
 * @param {object} existing current KreedumCommerce product with the same sourceUrl, if any
 * @param {Set} usedSlugs   website slugs already taken
 */
function buildProduct(sp, tree, existing, usedSlugs, issues) {
  const leaf = leafSlug(sp.categorySlug);
  const node = tree.get(leaf);
  const categoryPath = node?.path?.length ? node.path : sp.categoryPath || [];

  if (!node) issues.push({ code: "category_not_in_menu", url: sp.url, category: sp.categorySlug });

  const name = (sp.name || "").trim();
  const sku = sp.sku || "";
  const brand = (sp.brand || "").trim();

  const baseSlug = sku ? `${generateSlug(name)}-${generateSlug(sku)}` : generateSlug(name);
  const slug = uniqueSlug(baseSlug, sp.url, usedSlugs);

  const mrp = Number(sp.mrp) || 0;
  const sellingPrice = Number(sp.sellingPrice) || mrp;
  const discountPercent = mrp > sellingPrice && sellingPrice > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;

  const features = sp.features || [];
  const { specifications, highlights } = extractSpecifications(features);

  const categoryWords = categoryPath.map((slug) => tree.get(slug)?.name).filter(Boolean);
  const searchKeywords = [
    ...new Set([
      ...generateKeywords({ name, brand, sku, categorySlug: leaf }),
      ...categoryWords.map((w) => w.toLowerCase()),
    ]),
  ];

  const active = sp.status === "active";
  let visibility = brand && node ? "published" : "hidden";
  if (existing?.visibility === "draft") visibility = "draft"; // set by hand, keep it
  if (!active) visibility = "hidden";

  if (!brand) issues.push({ code: "no_brand_hidden", url: sp.url });

  // Metro shows no price (e.g. flooring, priced per area): sell on enquiry.
  const priceOnRequest = !sellingPrice;
  if (priceOnRequest) issues.push({ code: "price_on_request", url: sp.url });

  const descriptionText = sp.descriptionText || "";

  return {
    $set: {
      supplier: SUPPLIER,
      supplierProductId: String(sp._id || ""),
      sourceUrl: sp.url,
      lastSyncedAt: sp.lastScrapedAt || new Date(),

      name,
      slug,
      sku,
      brand: brand || "Unknown",
      brandSlug: brand ? generateSlug(brand) : "unknown",

      department: categoryPath[0] || "",
      parentCategory: categoryPath[1] || "",
      childCategory: categoryPath[2] || "",
      categoryPath,

      mrp,
      sellingPrice,
      discountPercent,

      thumbnail: sp.thumbnail || sp.images?.[0] || "",
      images: sp.images || [],

      descriptionHtml: sp.descriptionHtml || "",
      descriptionText,

      features,
      highlights,
      specifications,

      warranty: specifications.Warranty || "",
      maxUserWeight: specifications["Max User Weight"] || "",
      dimensions: specifications.Dimensions || "",
      weight: specifications.Weight || "",

      searchKeywords,
      seo: {
        title: `${name} | Kreedum Sports Lucknow`,
        description: seoDescription(sp.shortDescription || descriptionText) || `${name} available at Kreedum Sports Lucknow.`,
        keywords: searchKeywords,
      },

      visibility,
      isActive: active,
      ...(priceOnRequest ? { stockStatus: "enquiry_only" } : {}),
    },
    $setOnInsert: {
      ...(priceOnRequest ? {} : { stockStatus: "in_stock" }),
      availabilityMessage: DEFAULT_AVAILABILITY,
      countryOfOrigin: "India",
      isFeatured: false,
      isBestSeller: false,
      isNewArrival: false,
      isTrending: false,
      badge: "",
      displayOrder: 0,
      viewCount: 0,
      enquiryCount: 0,
      popularityScore: 0,
      syncVersion: 1,
    },
  };
}

/**
 * Work out every change without touching the database.
 */
function planRebuild({ supplierCategories, supplierProducts, existingProducts = [], existingCategories = [], existingBrands = [] }) {
  const issues = [];

  // ---------- categories
  const categories = buildCategoryDocs(supplierCategories);
  if (!categories.length) {
    throw new Error("No category tree in kreedum_supplier_sync. Run `npm run categories` in the scraper first.");
  }
  const tree = new Map(categories.map((c) => [c.slug, c]));
  const staleCategories = existingCategories.filter((c) => !tree.has(c.slug)).map((c) => c.slug);

  // ---------- products
  const existingByUrl = new Map(existingProducts.map((p) => [p.sourceUrl, p]));
  // A product Metro renamed is still the same website product (same _id).
  const findExisting = (sp) =>
    existingByUrl.get(sp.url) || (sp.previousUrls || []).map((u) => existingByUrl.get(u)).find(Boolean);
  const supplierUrls = new Set(supplierProducts.flatMap((p) => [p.url, ...(p.previousUrls || [])]));

  // Slugs held by products that stay as they are (not from this supplier feed).
  const usedSlugs = new Set(existingProducts.filter((p) => !supplierUrls.has(p.sourceUrl)).map((p) => p.slug));

  const products = [...supplierProducts]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((sp) => {
      const existing = findExisting(sp);
      return { sp, existing, update: buildProduct(sp, tree, existing, usedSlugs, issues) };
    });

  const removed = existingProducts.filter(
    (p) => p.sourceUrl && !supplierUrls.has(p.sourceUrl) && (p.isActive || p.visibility === "published")
  );

  // ---------- counts (what the website will show)
  const visible = products.map((p) => p.update.$set).filter((p) => p.isActive && p.visibility === "published");

  const categoryCounts = new Map(categories.map((c) => [c.slug, 0]));
  for (const p of visible) {
    for (const slug of p.categoryPath) categoryCounts.set(slug, (categoryCounts.get(slug) || 0) + 1);
  }

  const brandCounts = new Map();
  for (const p of visible) {
    if (p.brand === "Unknown") continue;
    const entry = brandCounts.get(p.brandSlug) || { name: p.brand, count: 0 };
    entry.count++;
    brandCounts.set(p.brandSlug, entry);
  }
  const staleBrands = existingBrands.filter((b) => !brandCounts.has(b.slug)).map((b) => b.slug);

  return {
    categories: categories.map((c) => ({ ...c, productCount: categoryCounts.get(c.slug) || 0 })),
    staleCategories,
    products,
    removed,
    brands: [...brandCounts].map(([slug, { name, count }]) => ({ slug, name, productCount: count })),
    staleBrands,
    issues,
    summary: {
      categories: categories.length,
      emptyCategories: categories.filter((c) => !categoryCounts.get(c.slug)).map((c) => c.slug),
      staleCategories,
      products: products.length,
      newProducts: products.filter((p) => !p.existing).length,
      visibleProducts: visible.length,
      hiddenProducts: products.length - visible.length,
      productsRemovedFromMetro: removed.length,
      slugChanges: products.filter((p) => p.existing && p.existing.slug !== p.update.$set.slug).length,
      brands: brandCounts.size,
      staleBrands,
      issues: issues.reduce((acc, i) => ({ ...acc, [i.code]: (acc[i.code] || 0) + 1 }), {}),
    },
  };
}

// ===================================================================
// DATABASE
// ===================================================================

async function applyPlan(plan) {
  // ---------- categories
  await Category.bulkWrite(
    plan.categories.map((c) => ({
      updateOne: { filter: { slug: c.slug }, update: { $set: c }, upsert: true },
    })),
    { ordered: false }
  );
  if (plan.staleCategories.length) {
    await Category.deleteMany({ slug: { $in: plan.staleCategories } });
  }
  console.log(`✅ Categories: ${plan.categories.length} saved, ${plan.staleCategories.length} removed`);

  // ---------- products
  // Free the slugs that are about to move, so the unique slug index never
  // sees two products holding the same slug mid-update.
  const moving = plan.products.filter((p) => p.existing && p.existing.slug !== p.update.$set.slug);
  for (let i = 0; i < moving.length; i += 500) {
    await Product.bulkWrite(
      moving.slice(i, i + 500).map((p) => ({
        updateOne: { filter: { _id: p.existing._id }, update: { $set: { slug: `rebuild-tmp-${p.existing._id}` } } },
      })),
      { ordered: false }
    );
  }

  let upserted = 0;
  let modified = 0;
  const errors = [];
  for (let i = 0; i < plan.products.length; i += 500) {
    try {
      const result = await Product.bulkWrite(
        plan.products.slice(i, i + 500).map((p) => ({
          updateOne: {
            filter: p.existing ? { _id: p.existing._id } : { sourceUrl: p.sp.url },
            update: p.update,
            upsert: true,
          },
        })),
        { ordered: false }
      );
      upserted += result.upsertedCount;
      modified += result.modifiedCount;
    } catch (error) {
      upserted += error.result?.upsertedCount || 0;
      modified += error.result?.modifiedCount || 0;
      for (const e of error.writeErrors || [error]) errors.push(e.errmsg || e.message);
    }
  }

  if (plan.removed.length) {
    await Product.updateMany(
      { _id: { $in: plan.removed.map((p) => p._id) } },
      { $set: { isActive: false, visibility: "hidden" } }
    );
  }
  console.log(`✅ Products: ${upserted} new, ${modified} updated, ${plan.removed.length} hidden (gone from Metro)`);
  if (errors.length) {
    console.log(`❌ ${errors.length} product writes failed, first ones:`);
    errors.slice(0, 5).forEach((e) => console.log("   ", e));
  }

  // ---------- brands
  await Brand.bulkWrite(
    plan.brands.map((b) => ({
      updateOne: {
        filter: { slug: b.slug },
        update: {
          $set: { name: b.name, slug: b.slug, productCount: b.productCount, isActive: true },
          $setOnInsert: {
            logo: "",
            description: "",
            featured: false,
            seo: {
              title: `${b.name} Sports & Gym Equipment | Kreedum Sports Lucknow`,
              description: `Explore ${b.name} gym and sports equipment available at Kreedum Sports Lucknow.`,
              keywords: [b.name, `${b.name} Sports`, `${b.name} Gym Equipment`, "Lucknow", "Kreedum Sports"],
            },
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  if (plan.staleBrands.length) {
    await Brand.updateMany({ slug: { $in: plan.staleBrands } }, { $set: { productCount: 0, isActive: false } });
  }
  console.log(`✅ Brands: ${plan.brands.length} active, ${plan.staleBrands.length} deactivated`);
}

/** Check the result the way the website will read it. */
async function verify() {
  const [categories, products] = await Promise.all([
    Category.find({}).lean(),
    Product.find({ isActive: true, visibility: "published" }, { department: 1, parentCategory: 1, childCategory: 1, brandSlug: 1 }).lean(),
  ]);
  const slugs = new Set(categories.map((c) => c.slug));

  const orphanProducts = products.filter(
    (p) => !slugs.has(p.department) || (p.parentCategory && !slugs.has(p.parentCategory)) || (p.childCategory && !slugs.has(p.childCategory))
  ).length;
  const emptyCategories = categories.filter((c) => !c.productCount).map((c) => c.slug);
  const orphanCategories = categories.filter((c) => c.parentSlug && !slugs.has(c.parentSlug)).map((c) => c.slug);

  console.log("============ CHECK ============");
  console.log(`Categories in menu          : ${categories.length}`);
  console.log(`Visible products            : ${products.length}`);
  console.log(`Products outside the menu   : ${orphanProducts}${orphanProducts ? "  ❌" : "  ✅"}`);
  console.log(`Categories with no parent   : ${orphanCategories.length}${orphanCategories.length ? "  ❌ " + orphanCategories.join(", ") : "  ✅"}`);
  console.log(`Categories with no products : ${emptyCategories.length}${emptyCategories.length ? "  ⚠️ " + emptyCategories.join(", ") : "  ✅"}`);
  console.log("===============================");
}

async function main() {
  const apply = process.argv.includes("--apply");

  await connectDatabase();
  const supplier = await connectSupplierDatabase();

  const supplierCategories = await supplier.collection("categories").find({ supplier: SUPPLIER, isActive: true }).toArray();
  const supplierProducts = await supplier.collection("products").find({ supplier: SUPPLIER }).toArray();

  const [existingProducts, existingCategories, existingBrands] = await Promise.all([
    Product.find({}, { sourceUrl: 1, slug: 1, visibility: 1, isActive: 1 }).lean(),
    Category.find({}, { slug: 1 }).lean(),
    Brand.find({}, { slug: 1 }).lean(),
  ]);

  const plan = planRebuild({ supplierCategories, supplierProducts, existingProducts, existingCategories, existingBrands });

  console.log("========== REBUILD PLAN ==========");
  console.log(JSON.stringify(plan.summary, null, 2));
  fs.writeFileSync("rebuild-report.json", JSON.stringify({ summary: plan.summary, issues: plan.issues }, null, 2));
  console.log(`📝 Details in ${path.resolve("rebuild-report.json")}`);

  if (!apply) {
    console.log("Dry run — nothing was written. Back up KreedumCommerce, then re-run with --apply.");
  } else {
    await applyPlan(plan);
    await verify();
  }

  await mongoose.disconnect();
  await supplier.close();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("❌", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { planRebuild, buildCategoryDocs };
