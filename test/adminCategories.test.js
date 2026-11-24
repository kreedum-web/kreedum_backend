// Admin: categories, product brand / category. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const Product = require("../src/models/Product");
const Category = require("../src/models/Category");
const Brand = require("../src/models/Brand");
const adminProducts = require("../src/services/admin/adminProductService");
const adminCategories = require("../src/services/admin/adminCategoryService");
const { withAdminCategories } = require("../src/utils/adminCategories");
const { planRebuild } = require("../src/migration/rebuildCatalog");
const { findIn } = require("./helpers/fakeQuery");

const tree = [
  { slug: "cardio", name: "Cardio", level: 1, path: ["cardio"], displayOrder: 0, isActive: true },
  { slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", rootSlug: "cardio", path: ["cardio", "treadmill"], isActive: true },
  { slug: "domestic-treadmill", name: "Domestic Treadmill", level: 3, parentSlug: "treadmill", rootSlug: "cardio", path: ["cardio", "treadmill", "domestic-treadmill"], isActive: true },
];

// ------------------------------------------------------------------ rebuild keeps admin categories

test("rebuild keeps categories made in the admin, and edits to supplier categories", () => {
  const existing = [
    { slug: "yoga-studio", name: "Yoga Studio", level: 1, addedBy: "admin", displayOrder: 9, isActive: true },
    { slug: "studio-mats", name: "Studio Mats", level: 2, parentSlug: "yoga-studio", addedBy: "admin" },
    { slug: "orphan", name: "Orphan", level: 2, parentSlug: "gone", addedBy: "admin" },
    { slug: "cardio", name: "Cardio Machines", displayOrder: 3, isActive: false, adminLocked: ["name", "isActive"] },
  ];
  const { categories, problems } = withAdminCategories(tree, existing);
  const by = new Map(categories.map((c) => [c.slug, c]));
  assert.deepEqual(by.get("studio-mats").path, ["yoga-studio", "studio-mats"]);
  assert.equal(by.get("studio-mats").level, 2);
  assert.equal(by.get("yoga-studio").addedBy, "admin");
  assert.equal(by.get("cardio").name, "Cardio Machines"); // locked
  assert.equal(by.get("cardio").isActive, false); // locked
  assert.equal(by.get("cardio").displayOrder, 0); // not locked: Metro's value
  assert.equal(by.has("orphan"), false);
  assert.match(problems[0], /orphan/);
});

test("rebuild doesn't delete admin categories and builds products with the admin's brand and category", () => {
  const sp = {
    _id: "s1",
    supplier: "metrosports",
    url: "https://metrosports.co.in/product/walkpad/",
    name: "Powermax Walkpad",
    brand: "Powermax Fitness",
    categorySlug: "unknown-metro-category",
    status: "active",
    sellingPrice: 20000,
    mrp: 25000,
  };
  const existingProduct = {
    _id: "p1",
    sourceUrl: sp.url,
    slug: "powermax-walkpad",
    adminLocked: ["brand", "brandSlug", "categoryPath", "department", "parentCategory", "childCategory"],
    brand: "Kreedum",
    brandSlug: "kreedum",
    categoryPath: ["yoga-studio"],
    department: "yoga-studio",
    parentCategory: "",
    childCategory: "",
  };
  const plan = planRebuild({
    supplierCategories: tree,
    supplierProducts: [sp],
    existingProducts: [existingProduct],
    existingCategories: [{ slug: "yoga-studio", name: "Yoga Studio", level: 1, addedBy: "admin" }],
  });
  assert.deepEqual(plan.staleCategories, []);
  const set = plan.products[0].update.$set;
  assert.deepEqual(set.categoryPath, ["yoga-studio"]);
  assert.equal(set.brand, "Kreedum");
  // Was hidden (Powermax is not sold, and Metro's category is unknown); the admin's choices publish it.
  assert.equal(set.visibility, "published");
  assert.ok(set.searchKeywords.includes("kreedum"));
  assert.equal(plan.categories.find((c) => c.slug === "yoga-studio").productCount, 1);
});

// ------------------------------------------------------------------ product brand / category

function fakeProduct(extra = {}) {
  return {
    _id: "64b0000000000000000000f1",
    name: "Cockatoo SmartWalk 4AH Walking Pad",
    sku: "",
    brand: "Cockatoo",
    brandSlug: "cockatoo",
    categoryPath: ["cardio", "treadmill", "domestic-treadmill"],
    department: "cardio",
    parentCategory: "treadmill",
    childCategory: "domestic-treadmill",
    sellingPrice: 19999,
    mrp: 24999,
    isActive: true,
    visibility: "published",
    hiddenBy: "",
    adminLocked: [],
    variants: [],
    images: [],
    save: async () => {},
    ...extra,
  };
}

function mockDb(t, product, { categories = [], brands = [] } = {}) {
  t.mock.method(Product, "findById", () => {
    const result = Promise.resolve(product);
    result.lean = async () => ({ ...product });
    return result;
  });
  const leanOf = (v) => ({ lean: async () => v });
  t.mock.method(Category, "findOne", (q) => leanOf(categories.find((c) => c.slug === q.slug) || null));
  t.mock.method(Category, "find", findIn(categories));
  t.mock.method(Brand, "find", findIn(brands));
  t.mock.method(Brand, "findOne", (q) => leanOf(brands.find((b) => b.slug === q.slug) || null));
  const created = [];
  t.mock.method(Brand, "create", async (doc) => created.push(doc));
  const incs = [];
  t.mock.method(Category, "updateMany", async (q, u) => incs.push(["category", q.slug.$in, u.$inc.productCount]));
  t.mock.method(Brand, "updateOne", async (q, u) => u.$inc && incs.push(["brand", q.slug, u.$inc.productCount]));
  return { created, incs };
}

test("product edit: new category sets the menu path, locks it and moves the counts", async (t) => {
  const product = fakeProduct();
  const walking = { slug: "walking-pads", name: "Walking Pads", level: 2, path: ["cardio", "walking-pads"] };
  const { incs } = mockDb(t, product, { categories: [walking, { slug: "cardio", name: "Cardio" }] });

  await adminProducts.update(product._id, { categorySlug: "walking-pads" });
  assert.deepEqual(product.categoryPath, ["cardio", "walking-pads"]);
  assert.equal(product.department, "cardio");
  assert.equal(product.parentCategory, "walking-pads");
  assert.equal(product.childCategory, "");
  for (const f of ["categoryPath", "department", "parentCategory", "childCategory"]) assert.ok(product.adminLocked.includes(f));
  assert.ok(product.searchKeywords.includes("walking pads"));
  assert.deepEqual(incs, [
    ["category", ["treadmill", "domestic-treadmill"], -1],
    ["category", ["walking-pads"], 1],
  ]);
  await assert.rejects(adminProducts.update(product._id, { categorySlug: "nope" }), /Category not found/);
});

test("product edit: brand change (new brand is created; a not-sold brand hides it)", async (t) => {
  const product = fakeProduct();
  const { created, incs } = mockDb(t, product);
  await adminProducts.update(product._id, { brand: "  Kreedum " });
  assert.equal(product.brand, "Kreedum");
  assert.equal(product.brandSlug, "kreedum");
  assert.ok(product.adminLocked.includes("brand") && product.adminLocked.includes("brandSlug"));
  assert.equal(created[0].slug, "kreedum");
  assert.deepEqual(incs, [["brand", "cockatoo", -1], ["brand", "kreedum", 1]]);

  await adminProducts.update(product._id, { brand: "Powermax Fitness" });
  assert.equal(product.visibility, "hidden");
  assert.equal(product.hiddenBy, "brand-rule");
  await adminProducts.update(product._id, { brand: "Cockatoo" });
  assert.equal(product.visibility, "published", "shown again: it was hidden only for its brand");
});

// ------------------------------------------------------------------ category admin

test("categories: create under a parent, max 3 levels, unique slug", async (t) => {
  const store = [...tree.map((c) => ({ ...c }))];
  t.mock.method(Category, "findOne", (q) => ({ lean: async () => store.find((c) => c.slug === q.slug) || null }));
  t.mock.method(Category, "find", (q = {}) => ({
    lean: async () => store.filter((c) => (q.parentSlug ? c.parentSlug === q.parentSlug : q.level ? c.level === q.level : true)),
  }));
  t.mock.method(Category, "exists", async (q) => store.some((c) => c.slug === q.slug));
  t.mock.method(Category, "create", async (doc) => (store.push(doc), doc));
  t.mock.method(Product, "aggregate", async () => []);

  const made = await adminCategories.create({ name: "Walking Pads", parentSlug: "cardio" });
  assert.equal(made.slug, "walking-pads");
  assert.deepEqual(made.path, ["cardio", "walking-pads"]);
  assert.equal(made.level, 2);
  assert.equal(made.fromAdmin, true);

  const top = await adminCategories.create({ name: "Yoga Studio" });
  assert.deepEqual(top.path, ["yoga-studio"]);
  assert.equal(top.level, 1);

  await assert.rejects(adminCategories.create({ name: "Walking pads", parentSlug: "cardio" }), /already exists/);
  await assert.rejects(adminCategories.create({ name: "Too Deep", parentSlug: "domestic-treadmill" }), /3 levels/);
  await assert.rejects(adminCategories.create({ name: "X", parentSlug: "cardio" }), /too short/);
});

test("categories: edits are locked; only empty admin categories can be deleted", async (t) => {
  const cardio = { slug: "cardio", name: "Cardio", displayOrder: 0, isActive: true, adminLocked: [], addedBy: "", save: async () => {} };
  const mine = { _id: "c2", slug: "yoga-studio", name: "Yoga Studio", addedBy: "admin", adminLocked: [], save: async () => {} };
  const docs = [cardio, mine];
  t.mock.method(Category, "findOne", async (q) => docs.find((c) => c.slug === q.slug) || null);
  t.mock.method(Category, "find", findIn(docs));
  t.mock.method(Brand, "find", findIn([]));
  t.mock.method(Product, "aggregate", async () => []);
  t.mock.method(Product, "find", findIn([]));

  await adminCategories.update("cardio", { name: "Cardio Machines", isActive: false });
  assert.deepEqual(cardio.adminLocked.sort(), ["isActive", "name"]);
  assert.equal(cardio.isActive, false);

  await assert.rejects(adminCategories.remove("cardio"), /hide it instead/);
  t.mock.method(Category, "exists", async () => null);
  t.mock.method(Product, "countDocuments", async () => 2);
  await assert.rejects(adminCategories.remove("yoga-studio"), /2 products/);
  t.mock.method(Product, "countDocuments", async () => 0);
  t.mock.method(Category, "deleteOne", async () => ({ deletedCount: 1 }));
  assert.deepEqual(await adminCategories.remove("yoga-studio"), { deleted: "yoga-studio" });
});
