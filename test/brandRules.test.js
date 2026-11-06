// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { isHiddenBrand, renameRuleFor, rebrand } = require("../src/utils/brandRules");
const { planBrandRules } = require("../src/migration/applyBrandRules");
const { planRebuild } = require("../src/migration/rebuildCatalog");

const rules = {
  hiddenBrands: ["powermax-fitness", "zorex-fitness"],
  renamedBrands: [{ from: "everise-fitness", to: "Kreedum", inCategories: ["outdoor"], oldWords: ["everise fitness", "everise"] }],
};
const everiseRule = rules.renamedBrands[0];

test("Powermax and Zorex are hidden; Everise is renamed only in outdoor categories", () => {
  assert.equal(isHiddenBrand("powermax-fitness", rules), true);
  assert.equal(isHiddenBrand("aerofit", rules), false);
  assert.equal(renameRuleFor("everise-fitness", ["outdoor-gym", "outdoor-fitness-equipment"], rules), everiseRule);
  assert.equal(renameRuleFor("everise-fitness", ["cardio", "treadmills"], rules), null);
  assert.equal(renameRuleFor("aerofit", ["outdoor-gym"], rules), null);
});

test("the old name is replaced everywhere in the text, any capitalisation, without doubling", () => {
  assert.equal(rebrand("EVERISE FITNESS Air Walker", everiseRule), "Kreedum Air Walker");
  assert.equal(rebrand("Everise outdoor gym by everise fitness", everiseRule), "Kreedum outdoor gym by Kreedum");
  assert.equal(rebrand("Kreedum Everise Fitness Chest Press", everiseRule), "Kreedum Chest Press");
  assert.equal(rebrand("Neverisen", everiseRule), "Neverisen"); // only whole words
  assert.deepEqual(rebrand({ Brand: "Everise Fitness", list: ["Made by Everise"] }, everiseRule), {
    Brand: "Kreedum",
    list: ["Made by Kreedum"],
  });
});

const product = (extra) => ({
  _id: extra.slug,
  sku: "",
  visibility: "published",
  isActive: true,
  hiddenBy: "",
  categoryPath: ["strength", "dumbbells"],
  searchKeywords: [],
  ...extra,
});

test("live catalogue: hides, renames (with a new web address) and shows again when a brand is taken off the list", () => {
  const products = [
    product({ slug: "powermax-tac-225", name: "Powermax Fitness TAC-225 Treadmill", brand: "Powermax Fitness", brandSlug: "powermax-fitness" }),
    product({ slug: "zorex-bench", name: "Zorex Bench", brand: "Zorex Fitness", brandSlug: "zorex-fitness", visibility: "hidden", hiddenBy: "brand-rule" }),
    product({
      slug: "everise-fitness-air-walker-eo-01",
      sku: "EO-01",
      name: "Everise Fitness Air Walker",
      brand: "Everise Fitness",
      brandSlug: "everise-fitness",
      categoryPath: ["outdoor-gym", "outdoor-fitness-equipment", "outdoor-gym-equipment"],
      descriptionText: "Everise outdoor walker for parks.",
      seo: { title: "Everise Fitness Air Walker | Kreedum Sports Lucknow", description: "By Everise.", keywords: ["everise fitness air walker"] },
      searchKeywords: ["everise fitness air walker", "air walker", "outdoor gym"],
    }),
    product({ slug: "everise-treadmill", name: "Everise Fitness Treadmill", brand: "Everise Fitness", brandSlug: "everise-fitness", categoryPath: ["cardio", "treadmills"] }),
    product({ slug: "aerofit-bike", name: "Aerofit Bike", brand: "Aerofit", brandSlug: "aerofit", visibility: "hidden", hiddenBy: "brand-rule" }),
  ];
  const plan = planBrandRules(products, rules);

  assert.deepEqual(plan.hide.map((p) => p.slug), ["powermax-tac-225"]); // Zorex already hidden
  assert.deepEqual(plan.unhide.map((p) => p.slug), ["aerofit-bike"]); // no longer on the list
  assert.equal(plan.renames.length, 1);
  const { $set } = plan.renames[0];
  assert.equal($set.brand, "Kreedum");
  assert.equal($set.brandSlug, "kreedum");
  assert.equal($set.name, "Kreedum Air Walker");
  assert.equal($set.slug, "kreedum-air-walker-eo-01");
  assert.equal($set.descriptionText, "Kreedum outdoor walker for parks.");
  assert.equal($set.seo.title, "Kreedum Air Walker | Kreedum Sports Lucknow");
  assert.ok(!$set.searchKeywords.some((word) => /everise/i.test(word)));
  assert.ok($set.searchKeywords.includes("kreedum"));
  // the treadmill isn't in an outdoor category: still Everise
  assert.equal(products[3].brand, "Everise Fitness");

  // running again after applying changes nothing
  const applied = products.map((p) => {
    if (plan.hide.includes(p)) return { ...p, visibility: "hidden", hiddenBy: "brand-rule" };
    if (plan.unhide.includes(p)) return { ...p, visibility: "published", hiddenBy: "" };
    const renamed = plan.renames.find((r) => r.product === p);
    return renamed ? { ...p, ...renamed.$set } : p;
  });
  const again = planBrandRules(applied, rules);
  assert.deepEqual([again.hide.length, again.unhide.length, again.renames.length], [0, 0, 0]);
});

test("catalogue rebuild follows the same rules, so it never undoes them", () => {
  const categories = [
    { slug: "outdoor-gym", name: "Outdoor Gym", level: 1, path: ["outdoor-gym"] },
    { slug: "outdoor-gym-equipment", name: "Outdoor Gym Equipment", level: 2, parentSlug: "outdoor-gym", path: ["outdoor-gym", "outdoor-gym-equipment"] },
    { slug: "treadmills", name: "Treadmills", level: 1, path: ["treadmills"] },
  ];
  const sp = (extra) => ({ status: "active", sellingPrice: 1000, mrp: 1200, ...extra });
  const plan = planRebuild({
    supplierCategories: categories,
    supplierProducts: [
      sp({ _id: "1", url: "u1", name: "Everise Fitness Air Walker", sku: "EO-01", brand: "Everise Fitness", categorySlug: "outdoor-gym-equipment", descriptionText: "Everise walker." }),
      sp({ _id: "2", url: "u2", name: "Powermax Fitness TAC-225", brand: "Powermax Fitness", categorySlug: "treadmills" }),
      sp({ _id: "3", url: "u3", name: "Everise Fitness Treadmill", brand: "Everise Fitness", categorySlug: "treadmills" }),
    ],
    existingBrands: [{ slug: "powermax-fitness" }, { slug: "everise-fitness" }],
  });
  const [walker, powermax, treadmill] = plan.products.map((p) => p.update.$set);
  assert.deepEqual([walker.brand, walker.brandSlug, walker.name, walker.slug], ["Kreedum", "kreedum", "Kreedum Air Walker", "kreedum-air-walker-eo-01"]);
  assert.equal(walker.descriptionText, "Kreedum walker.");
  assert.deepEqual([powermax.visibility, powermax.hiddenBy], ["hidden", "brand-rule"]);
  assert.equal(treadmill.brand, "Everise Fitness");
  assert.deepEqual(plan.brands.map((b) => b.slug).sort(), ["everise-fitness", "kreedum"]);
  assert.deepEqual(plan.staleBrands, ["powermax-fitness"]); // → set inactive, kept in the database
});
