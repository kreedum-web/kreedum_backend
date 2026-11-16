// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { withCategoryRules, movedCategoryPath } = require("../src/utils/categoryRules");
const { planCategoryRules } = require("../src/migration/applyCategoryRules");
const { planRebuild } = require("../src/migration/rebuildCatalog");

const rules = {
  renamedCategories: [{ slug: "home-gym", name: "Multi Gym" }],
  newCategories: [
    { slug: "punching-bags", name: "Punching Bags", parent: "boxing" },
    { slug: "boxing-gloves", name: "Boxing Gloves", parent: "boxing" },
    { slug: "gym-gloves", name: "Gym Gloves", parent: "accessories" },
  ],
  productMoves: [
    { from: "boxing", to: "gym-gloves", words: ["weightlifting glove"] },
    { from: "boxing", to: "boxing-gloves", words: ["glove"] },
    { from: "boxing", to: "punching-bags", words: ["bag"] },
  ],
};

const categories = [
  { slug: "strength", name: "Strength", level: 1, path: ["strength"], displayOrder: 1 },
  { slug: "home-gym", name: "Home Gym", level: 2, parentSlug: "strength", path: ["strength", "home-gym"], displayOrder: 1 },
  { slug: "accessories", name: "Accessories", level: 1, path: ["accessories"], displayOrder: 2 },
  { slug: "boxing", name: "Boxing", level: 2, parentSlug: "accessories", path: ["accessories", "boxing"], displayOrder: 1 },
  { slug: "boxing-stand", name: "Boxing Stand", level: 3, parentSlug: "boxing", path: ["accessories", "boxing", "boxing-stand"], displayOrder: 4 },
];

const product = (id, name, categoryPath) => ({ _id: id, name, categoryPath, visibility: "published", isActive: true, searchKeywords: [] });

test("category rules: rename keeps the address; new categories go under their parent, after Metro's", () => {
  const { categories: result, problems } = withCategoryRules(categories, rules);
  assert.deepEqual(problems, []);
  const bySlug = new Map(result.map((c) => [c.slug, c]));
  assert.equal(bySlug.get("home-gym").name, "Multi Gym");
  assert.deepEqual(bySlug.get("punching-bags").path, ["accessories", "boxing", "punching-bags"]);
  assert.equal(bySlug.get("punching-bags").level, 3);
  assert.deepEqual([bySlug.get("punching-bags").displayOrder, bySlug.get("boxing-gloves").displayOrder], [5, 6]);
  assert.deepEqual([bySlug.get("gym-gloves").level, bySlug.get("gym-gloves").displayOrder], [2, 2]);
  assert.equal(bySlug.get("gym-gloves").addedBy, "category-rule");
});

test("category rules: a mistake in the rules is reported, not crashed on", () => {
  const broken = {
    renamedCategories: [{ slug: "nope", name: "X" }],
    newCategories: [{ slug: "a", name: "A", parent: "missing" }, { slug: "b", name: "B", parent: "boxing-stand" }],
    productMoves: [{ from: "boxing", to: "missing", words: ["x"] }],
  };
  const { problems } = withCategoryRules(categories, broken);
  assert.equal(problems.length, 4);
});

test("category rules: products move by the words in their name; first rule wins", () => {
  const { categories: result } = withCategoryRules(categories, rules);
  const tree = new Map(result.map((c) => [c.slug, c]));
  const path = (name, from = ["accessories", "boxing"]) => movedCategoryPath({ name, categoryPath: from }, tree, rules);
  assert.deepEqual(path("Xpeed XP-901 Fusion Weightlifting Gloves"), ["accessories", "gym-gloves"]);
  assert.deepEqual(path("Xpeed XP-402 Performer Bag Gloves"), ["accessories", "boxing", "boxing-gloves"]);
  assert.deepEqual(path("Xpeed XP-201 Carbonium PU Punchbag"), ["accessories", "boxing", "punching-bags"]);
  assert.equal(path("Xpeed XP-407 Speed Ball"), null); // no rule: stays
  assert.equal(path("Leather Gloves", ["strength", "home-gym"]), null); // not under "boxing"
  assert.equal(path("Boxing Gloves", ["accessories", "boxing", "boxing-gloves"]), null); // already there
});

test("categories:apply plan: renames, adds, moves and counts; running it again changes nothing", () => {
  const products = [
    product("p1", "Boxing Gloves 12oz", ["accessories", "boxing"]),
    product("p2", "Heavy Punch Bag", ["accessories", "boxing"]),
    product("p3", "Weightlifting Gloves", ["accessories", "boxing"]),
    product("p4", "Wall Bracket", ["accessories", "boxing", "boxing-stand"]),
    product("p5", "Speed Ball", ["accessories", "boxing"]),
    product("p6", "Aerofit Home Gym", ["strength", "home-gym"]),
  ];
  const plan = planCategoryRules(categories, products, rules);
  assert.deepEqual(plan.renamed.map((c) => [c.slug, c.name]), [["home-gym", "Multi Gym"]]);
  assert.deepEqual(plan.added.map((c) => c.slug), ["punching-bags", "boxing-gloves", "gym-gloves"]);
  assert.deepEqual(
    plan.moves.map((m) => [m.product._id, m.$set.categoryPath.at(-1)]),
    [["p1", "boxing-gloves"], ["p2", "punching-bags"], ["p3", "gym-gloves"]]
  );
  const move = plan.moves[0].$set;
  assert.deepEqual([move.department, move.parentCategory, move.childCategory], ["accessories", "boxing", "boxing-gloves"]);
  assert.ok(move.searchKeywords.includes("boxing gloves"));
  assert.equal(plan.counts.get("boxing"), 4); // p1, p2, p4, p5
  assert.equal(plan.counts.get("accessories"), 5);
  assert.equal(plan.counts.get("gym-gloves"), 1);
  assert.deepEqual(plan.leftOver.map((p) => p._id), ["p5"]); // reported in the dry run
  assert.deepEqual(plan.keywordAdds.map((k) => [k.product._id, k.$set.searchKeywords]), [["p6", ["multi gym"]]]);

  // After applying: nothing more to do.
  const appliedCategories = [...categories.map((c) => (c.slug === "home-gym" ? { ...c, name: "Multi Gym" } : c)), ...plan.added];
  const appliedProducts = products.map((p) => {
    const m = plan.moves.find((x) => x.product === p);
    const k = plan.keywordAdds.find((x) => x.product === p);
    return m ? { ...p, ...m.$set } : k ? { ...p, ...k.$set } : p;
  });
  const again = planCategoryRules(appliedCategories, appliedProducts, rules);
  assert.deepEqual([again.renamed.length, again.added.length, again.moves.length, again.keywordAdds.length], [0, 0, 0, 0]);
});

test("catalogue rebuild follows the category rules, so it never undoes them", (t) => {
  const live = require("../src/config/categoryRules");
  const saved = { ...live };
  Object.assign(live, rules);
  t.after(() => Object.assign(live, saved));

  const sp = (extra) => ({ status: "active", sellingPrice: 1000, mrp: 1200, brand: "Xpeed", ...extra });
  const plan = planRebuild({
    supplierCategories: categories.map((c) => ({ ...c, isActive: true })),
    supplierProducts: [
      sp({ _id: "1", url: "u1", name: "Xpeed Boxing Gloves", categorySlug: "boxing" }),
      sp({ _id: "2", url: "u2", name: "Xpeed Weightlifting Gloves", categorySlug: "boxing" }),
      sp({ _id: "3", url: "u3", name: "Xpeed Home Gym", categorySlug: "home-gym" }),
    ],
    existingCategories: [{ slug: "punching-bags" }, { slug: "gym-gloves" }],
  });
  const [gloves, lifting, gym] = plan.products.map((p) => p.update.$set);
  assert.deepEqual(gloves.categoryPath, ["accessories", "boxing", "boxing-gloves"]);
  assert.equal(gloves.childCategory, "boxing-gloves");
  assert.deepEqual(lifting.categoryPath, ["accessories", "gym-gloves"]);
  assert.deepEqual(gym.categoryPath, ["strength", "home-gym"]);

  const bySlug = new Map(plan.categories.map((c) => [c.slug, c]));
  assert.equal(bySlug.get("home-gym").name, "Multi Gym");
  assert.equal(bySlug.get("boxing-gloves").productCount, 1);
  assert.equal(bySlug.get("gym-gloves").productCount, 1);
  assert.deepEqual(plan.staleCategories, []); // rule-added categories are never deleted by a rebuild
  assert.deepEqual(plan.issues.filter((i) => i.code === "category_rule_problem"), []);
});
