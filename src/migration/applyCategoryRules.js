/**
 * Apply src/config/categoryRules.js to the live catalogue, without a full rebuild.
 *
 *   npm run categories:apply              dry run: shows what would change
 *   npm run categories:apply -- --apply   makes the changes
 *
 * - renamed categories get their new name (same web address)
 * - new categories are added to the menu
 * - products are moved by the words in their name (e.g. boxing gloves into
 *   "Boxing & MMA Gloves")
 * - product counts of every category are worked out again
 * Safe to run any number of times. The catalogue rebuild follows the same rules.
 */
require("../config/bootstrap");

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { withCategoryRules, movedCategoryPath, unmatchedProducts, RULES } = require("../utils/categoryRules");

/**
 * Work out every change without touching the database.
 * @param categories  current categories
 * @param products    { _id, name, categoryPath, searchKeywords, visibility, isActive }
 */
function planCategoryRules(categories, products, rules = RULES) {
  const current = new Map(categories.map((c) => [c.slug, c]));
  const { categories: wanted, problems } = withCategoryRules(categories, rules);
  const tree = new Map(wanted.map((c) => [c.slug, c]));

  const renamed = wanted.filter((c) => current.has(c.slug) && current.get(c.slug).name !== c.name);
  const added = wanted.filter((c) => !current.has(c.slug));

  const moves = [];
  const keywordAdds = [];
  const renamedSlugs = new Map(renamed.map((c) => [c.slug, c.name.toLowerCase()]));
  for (const p of products) {
    const path = movedCategoryPath(p, tree, rules);
    if (!path) {
      // Products in a renamed category: also found by the new name ("multi gym").
      const words = (p.categoryPath || []).map((slug) => renamedSlugs.get(slug)).filter(Boolean);
      const missing = words.filter((w) => !(p.searchKeywords || []).includes(w));
      if (missing.length) keywordAdds.push({ product: p, $set: { searchKeywords: [...(p.searchKeywords || []), ...missing] } });
      continue;
    }
    const words = path.map((slug) => tree.get(slug)?.name?.toLowerCase()).filter(Boolean);
    moves.push({
      product: p,
      from: p.categoryPath || [],
      $set: {
        department: path[0] || "",
        parentCategory: path[1] || "",
        childCategory: path[2] || "",
        categoryPath: path,
        searchKeywords: [...new Set([...(p.searchKeywords || []), ...words])],
      },
    });
  }

  // What the menu will count once the moves are done.
  const movedPath = new Map(moves.map((m) => [String(m.product._id), m.$set.categoryPath]));
  const counts = new Map(wanted.map((c) => [c.slug, 0]));
  const after = products.map((p) => ({ ...p, categoryPath: movedPath.get(String(p._id)) || p.categoryPath || [] }));
  for (const p of after) {
    if (!p.isActive || p.visibility !== "published") continue;
    for (const slug of p.categoryPath) if (counts.has(slug)) counts.set(slug, counts.get(slug) + 1);
  }

  const leftOver = unmatchedProducts(after.filter((p) => p.isActive && p.visibility === "published"), rules);
  return { renamed, added, moves, keywordAdds, counts, leftOver, problems };
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDatabase();

  const [categories, products] = await Promise.all([
    Category.find({}).lean(),
    Product.find({}, { name: 1, categoryPath: 1, searchKeywords: 1, visibility: 1, isActive: 1 }).lean(),
  ]);
  const plan = planCategoryRules(categories, products);

  console.log("========== CATEGORY RULES ==========");
  plan.problems.forEach((p) => console.log(`⚠️  ${p}`));
  plan.renamed.forEach((c) => console.log(`Rename  : ${c.slug}  "${categories.find((x) => x.slug === c.slug).name}" → "${c.name}"`));
  plan.added.forEach((c) => console.log(`New     : ${c.path.join(" › ")}  "${c.name}"`));
  console.log(`Products to move: ${plan.moves.length}`);
  if (plan.keywordAdds.length) console.log(`Products also findable by a new category name: ${plan.keywordAdds.length}`);
  const byTarget = new Map();
  for (const m of plan.moves) {
    const key = m.$set.categoryPath.at(-1);
    byTarget.set(key, [...(byTarget.get(key) || []), m.product.name]);
  }
  for (const [slug, names] of byTarget) {
    console.log(`  → ${slug} (${names.length}): ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""}`);
  }
  if (plan.leftOver.length) {
    console.log(`Still right in a split category (no rule matched): ${plan.leftOver.map((p) => p.name).join(", ")}`);
  }

  if (!apply) {
    console.log("Dry run — nothing changed. Run again with: npm run categories:apply -- --apply");
    await mongoose.disconnect();
    return;
  }

  // Categories first, so moved products never point at a missing one.
  const docs = [...plan.renamed, ...plan.added];
  if (docs.length) {
    await Category.bulkWrite(
      docs.map((c) => {
        const { _id, createdAt, updatedAt, __v, ...fields } = c;
        return { updateOne: { filter: { slug: c.slug }, update: { $set: fields }, upsert: true } };
      }),
      { ordered: false }
    );
  }
  const productUpdates = [...plan.moves, ...plan.keywordAdds];
  for (let i = 0; i < productUpdates.length; i += 500) {
    await Product.bulkWrite(
      productUpdates.slice(i, i + 500).map((m) => ({ updateOne: { filter: { _id: m.product._id }, update: { $set: m.$set } } })),
      { ordered: false }
    );
  }
  await Category.bulkWrite(
    [...plan.counts].map(([slug, productCount]) => ({ updateOne: { filter: { slug }, update: { $set: { productCount } } } })),
    { ordered: false }
  );

  console.log(`✅ Done. ${plan.renamed.length} renamed, ${plan.added.length} added, ${plan.moves.length} products moved.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("❌", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { planCategoryRules };
