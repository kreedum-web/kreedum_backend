/**
 * Apply src/config/brandRules.js to the live catalogue, without a full rebuild.
 *
 *   npm run brands:apply              dry run: shows what would change
 *   npm run brands:apply -- --apply   makes the changes
 *
 * - hidden brands: their products are hidden on the website (kept in the
 *   database, marked hiddenBy "brand-rule"), the brand is set inactive.
 *   Remove a brand from the list and run this again to show it again.
 * - renamed brands: e.g. Everise Fitness outdoor gym products become
 *   "Kreedum" (brand, name, description, features, SEO, web address).
 * Safe to run any number of times.
 */
require("../config/bootstrap");

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const Product = require("../models/Product");
const Brand = require("../models/Brand");
const generateSlug = require("../utils/generateSlug");
const generateKeywords = require("../utils/generateKeywords");
const { isHiddenBrand, renameRuleFor, rebrand, RULES } = require("../utils/brandRules");

const TEXT_FIELDS = ["name", "descriptionHtml", "descriptionText", "features", "highlights", "specifications", "seo"];

/**
 * Work out every change without touching the database.
 * @param products  { _id, slug, sku, name, brand, brandSlug, categoryPath, visibility, isActive, hiddenBy, ...text fields }
 */
function planBrandRules(products, rules = RULES) {
  const hide = [];
  const unhide = [];
  const renames = [];
  const takenSlugs = new Set(products.map((p) => p.slug));

  for (const p of products) {
    // ---------- hidden brands
    if (isHiddenBrand(p.brandSlug, rules)) {
      if (p.visibility !== "hidden" || p.hiddenBy !== "brand-rule") hide.push(p);
      continue;
    }
    if (p.hiddenBy === "brand-rule") unhide.push(p);

    // ---------- renamed brands
    const rule = renameRuleFor(p.brandSlug, p.categoryPath || [], rules);
    if (!rule) continue;

    const $set = { brand: rule.to, brandSlug: generateSlug(rule.to) };
    for (const field of TEXT_FIELDS) if (p[field] !== undefined) $set[field] = rebrand(p[field], rule);
    $set.searchKeywords = [
      ...new Set([
        ...generateKeywords({ name: $set.name, brand: rule.to, sku: p.sku || "", categorySlug: (p.categoryPath || []).at(-1) || "" }),
        ...(p.searchKeywords || []).filter((word) => !rule.oldWords.some((old) => word.toLowerCase().includes(old))),
      ]),
    ];
    if ($set.seo) $set.seo = { ...$set.seo, keywords: $set.searchKeywords };

    // Same web address the catalogue rebuild will give it (name + SKU).
    const slug = p.sku ? `${generateSlug($set.name)}-${generateSlug(p.sku)}` : generateSlug($set.name);
    if (slug !== p.slug && !takenSlugs.has(slug)) {
      takenSlugs.add(slug);
      $set.slug = slug;
    }
    renames.push({ product: p, $set });
  }
  return { hide, unhide, renames };
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDatabase();

  const products = await Product.find({}).lean();
  const plan = planBrandRules(products);

  console.log("========== BRAND RULES ==========");
  console.log(`Hidden brands  : ${RULES.hiddenBrands.join(", ") || "(none)"}`);
  console.log(`Products to hide        : ${plan.hide.length}`);
  console.log(`Products to show again  : ${plan.unhide.length}`);
  console.log(`Products to rename      : ${plan.renames.length}`);
  for (const { product, $set } of plan.renames.slice(0, 10)) {
    console.log(`  "${product.name}" → "${$set.name}"${$set.slug ? `  (/${$set.slug})` : ""}`);
  }
  if (plan.renames.length > 10) console.log(`  … and ${plan.renames.length - 10} more`);

  if (!apply) {
    console.log("Dry run — nothing changed. Run again with: npm run brands:apply -- --apply");
    await mongoose.disconnect();
    return;
  }

  if (plan.hide.length) {
    await Product.updateMany(
      { _id: { $in: plan.hide.map((p) => p._id) } },
      { $set: { visibility: "hidden", hiddenBy: "brand-rule" } }
    );
  }
  if (plan.unhide.length) {
    // Shown again only if nothing else hides it (inactive at the supplier, no category).
    await Product.updateMany(
      { _id: { $in: plan.unhide.map((p) => p._id) } },
      { $set: { visibility: "published", hiddenBy: "" } }
    );
  }
  for (let i = 0; i < plan.renames.length; i += 500) {
    await Product.bulkWrite(
      plan.renames.slice(i, i + 500).map(({ product, $set }) => ({ updateOne: { filter: { _id: product._id }, update: { $set } } })),
      { ordered: false }
    );
  }

  // ---------- brands: counts from what the website now shows
  const counts = await Product.aggregate([
    { $match: { visibility: "published", isActive: true } },
    { $group: { _id: "$brandSlug", name: { $first: "$brand" }, count: { $sum: 1 } } },
  ]);
  const visible = new Map(counts.filter((c) => c._id && c._id !== "unknown").map((c) => [c._id, c]));

  for (const rule of RULES.renamedBrands) {
    const slug = generateSlug(rule.to);
    if (visible.has(slug)) {
      await Brand.updateOne(
        { slug },
        { $set: { name: rule.to, slug, isActive: true }, $setOnInsert: { description: "", logo: "", featured: false } },
        { upsert: true }
      );
    }
  }
  const brands = await Brand.find({}, { slug: 1 }).lean();
  await Brand.bulkWrite(
    brands.map((b) => ({
      updateOne: {
        filter: { _id: b._id },
        update: {
          $set: {
            productCount: visible.get(b.slug)?.count || 0,
            isActive: visible.has(b.slug) && !isHiddenBrand(b.slug),
          },
        },
      },
    }))
  );

  const active = brands.filter((b) => visible.has(b.slug) && !isHiddenBrand(b.slug)).length;
  console.log(`✅ Done. ${plan.hide.length} hidden, ${plan.unhide.length} shown again, ${plan.renames.length} renamed. Brands on the website: ${active}.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("❌", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { planBrandRules };
