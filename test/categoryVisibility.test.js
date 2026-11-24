// Hiding a category (or brand) in the admin hides its products. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const Product = require("../src/models/Product");
const Brand = require("../src/models/Brand");
const Category = require("../src/models/Category");
const { reconcileVisibility, refreshVisibility } = require("../src/utils/productVisibility");
const adminCategories = require("../src/services/admin/adminCategoryService");
const adminProducts = require("../src/services/admin/adminProductService");
const categoryService = require("../src/services/categoryService");
const { planRebuild } = require("../src/migration/rebuildCatalog");
const { findIn, matches } = require("./helpers/fakeQuery");

const live = (extra = {}) => ({ isActive: true, visibility: "published", hiddenBy: "", ...extra });
const hidden = (hiddenBy, extra = {}) => ({ isActive: false, visibility: "hidden", hiddenBy, ...extra });
const state = (p) => ({ isActive: p.isActive, visibility: p.visibility, hiddenBy: p.hiddenBy });

test("visibility rules: category and brand switches, hand-hidden products untouched", () => {
  const ctx = { hiddenBrands: new Set(["acme"]), hiddenCategories: new Set(["cardio"]) };
  const inCardio = { brandSlug: "aerofit", categoryPath: ["cardio", "treadmill"] };

  let p = { ...inCardio, ...live() };
  assert.equal(reconcileVisibility(p, ctx), true);
  assert.deepEqual(state(p), hidden("admin-category"), "a hidden category above it counts too");

  p = { ...inCardio, ...hidden("admin") };
  assert.equal(reconcileVisibility(p, ctx), false, "switched off by hand: left alone");

  p = { brandSlug: "aerofit", categoryPath: ["strength"], ...hidden("admin-category") };
  reconcileVisibility(p, ctx);
  assert.deepEqual(state(p), live(), "its category is on again");

  p = { brandSlug: "acme", categoryPath: ["strength"], ...hidden("admin-category") };
  reconcileVisibility(p, ctx);
  assert.deepEqual(state(p), hidden("admin-brand"), "category on again, but its brand is off");

  p = { brandSlug: "aerofit", categoryPath: ["strength"], ...hidden("admin", { hiddenBy: "" }) };
  assert.equal(reconcileVisibility(p, ctx), false, "hidden for another reason (e.g. no category): left alone");
});

/** In-memory products, brands and categories behind the models. */
function fakeStore(t, { products, categories, brands = [] }) {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  t.mock.method(Product, "find", (query) => ({ lean: async () => products.filter((p) => matchesProduct(p, query)).map((p) => ({ ...p })) }));
  t.mock.method(Product, "bulkWrite", async (ops) => ops.forEach(({ updateOne }) => Object.assign(byId.get(String(updateOne.filter._id)), updateOne.update.$set)));
  t.mock.method(Product, "aggregate", async () => []);
  t.mock.method(Category, "find", findIn(categories));
  t.mock.method(Category, "bulkWrite", async () => ({}));
  t.mock.method(Brand, "find", findIn(brands));
  t.mock.method(Brand, "bulkWrite", async () => ({}));
}
function matchesProduct(p, { $or, ...rest }) {
  return matches(p, rest) && (!$or || $or.some((q) => matches(p, q)));
}

test("hide a category: its products and its sub-categories' products go off; showing it brings them back", async (t) => {
  const cardio = { _id: "c1", slug: "cardio", name: "Cardio", level: 1, path: ["cardio"], isActive: true, adminLocked: [], save: async () => {} };
  const treadmill = { _id: "c2", slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", path: ["cardio", "treadmill"], isActive: true };
  const categories = [cardio, treadmill];
  const products = [
    { _id: "p1", brandSlug: "aerofit", categoryPath: ["cardio", "treadmill"], ...live() },
    { _id: "p2", brandSlug: "aerofit", categoryPath: ["cardio"], ...hidden("admin") },
    { _id: "p3", brandSlug: "aerofit", categoryPath: ["strength"], ...live() },
  ];
  fakeStore(t, { products, categories });
  t.mock.method(Category, "findOne", async (q) => categories.find((c) => c.slug === q.slug) || null);

  const off = await adminCategories.update("cardio", { isActive: false });
  assert.equal(off.isActive, false);
  assert.equal(off.productsHidden, 1);
  assert.deepEqual(state(products[0]), hidden("admin-category"));
  assert.deepEqual(state(products[1]), hidden("admin"), "already off by hand");
  assert.deepEqual(state(products[2]), live(), "other categories untouched");

  const list = await adminCategories.list();
  assert.equal(list.find((c) => c.slug === "treadmill").hiddenByParent, true);

  const on = await adminCategories.update("cardio", { isActive: true });
  assert.equal(on.productsShown, 1);
  assert.deepEqual(state(products[0]), live());
  assert.deepEqual(state(products[1]), hidden("admin"), "stays off: it was switched off on its own page");
});

test("switch a brand on: products in a hidden category stay hidden", async (t) => {
  const products = [
    { _id: "p1", brandSlug: "acme", categoryPath: ["cardio"], ...hidden("admin-brand") },
    { _id: "p2", brandSlug: "acme", categoryPath: ["strength"], ...hidden("admin-brand") },
  ];
  const brand = { slug: "acme", name: "Acme", adminHidden: true, isActive: false, save: async () => { brand.adminHidden = false; } };
  fakeStore(t, { products, categories: [{ slug: "cardio", isActive: false }], brands: [] });
  t.mock.method(Brand, "findOne", async () => brand);
  t.mock.method(adminProducts, "listBrands", async () => [{ slug: "acme" }]);
  await adminProducts.updateBrand("acme", { live: true });
  assert.deepEqual(state(products[0]), hidden("admin-category"));
  assert.deepEqual(state(products[1]), live());
});

test("product edit: can't be switched on inside a hidden category; moving it out shows it", async (t) => {
  const product = {
    _id: "64b000000000000000000001", name: "Treadmill X", brand: "Aerofit", brandSlug: "aerofit",
    categoryPath: ["cardio"], adminLocked: [], variants: [], ...hidden("admin-category"),
  };
  product.save = async () => product;
  t.mock.method(Product, "findById", () => {
    const r = Promise.resolve(product);
    r.lean = async () => ({ ...product });
    return r;
  });
  const categories = [
    { slug: "cardio", name: "Cardio", isActive: false, path: ["cardio"] },
    { slug: "strength", name: "Strength", isActive: true, path: ["strength"] },
  ];
  t.mock.method(Category, "find", findIn(categories));
  t.mock.method(Category, "findOne", (q) => ({ lean: async () => categories.find((c) => c.slug === q.slug) || null }));
  t.mock.method(Category, "updateMany", async () => ({}));
  t.mock.method(Brand, "find", findIn([]));
  t.mock.method(Brand, "updateOne", async () => ({}));

  let result = await adminProducts.update(product._id, { live: true });
  assert.equal(result.live, false);
  assert.equal(result.hiddenBy, "admin-category");

  result = await adminProducts.update(product._id, { categorySlug: "strength" });
  assert.equal(result.live, true, "hidden only because of its old category");
});

test("catalogue rebuild: products in a category hidden in the admin stay hidden", () => {
  const plan = planRebuild({
    supplierCategories: [
      { slug: "cardio", name: "Cardio", level: 1, path: ["cardio"] },
      { slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", path: ["cardio", "treadmill"] },
    ],
    existingCategories: [{ slug: "cardio", name: "Cardio", isActive: false, adminLocked: ["isActive"] }],
    supplierProducts: [
      { _id: "m1", url: "https://metro/a", name: "Treadmill A", brand: "Aerofit", categorySlug: "treadmill", status: "active", sellingPrice: 100 },
    ],
    existingProducts: [
      // switched on by hand earlier (locked), then its category was hidden
      { _id: "e1", sourceUrl: "https://metro/a", slug: "treadmill-a", adminLocked: ["isActive", "visibility", "hiddenBy"], ...live() },
    ],
  });
  const $set = plan.products[0].update.$set;
  assert.deepEqual(state($set), hidden("admin-category"));
  assert.equal(plan.categories.find((c) => c.slug === "cardio").isActive, false);
});

test("website: a hidden category's page (and its sub-categories' pages) are not found", async (t) => {
  const categories = [
    { slug: "cardio", name: "Cardio", level: 1, path: ["cardio"], isActive: false },
    { slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", rootSlug: "cardio", path: ["cardio", "treadmill"] },
  ];
  t.mock.method(Category, "findOne", (q) => ({ lean: async () => categories.find((c) => c.slug === q.slug) || null }));
  t.mock.method(Category, "exists", async (q) => categories.some((c) => matches(c, q)));
  assert.equal(await categoryService.getCategoryBySlug("cardio"), null);
  assert.equal(await categoryService.getCategoryBySlug("treadmill"), null);
});

test("bulk show / hide: every product matching the filters, like their own switches", async (t) => {
  const products = [
    { _id: "p1", name: "A", brandSlug: "aerofit", categoryPath: ["cardio"], adminLocked: [], ...live() },
    { _id: "p2", name: "B", brandSlug: "aerofit", categoryPath: ["strength"], adminLocked: [], ...hidden("admin") },
    { _id: "p3", name: "C", brandSlug: "aerofit", categoryPath: ["yoga"], adminLocked: [], ...hidden("admin") },
    { _id: "p4", name: "D", brandSlug: "aerofit", categoryPath: ["strength"], adminLocked: [], ...hidden("") }, // gone from supplier
    { _id: "p5", name: "E", brandSlug: "aerofit", categoryPath: ["yoga"], adminLocked: [], ...hidden("admin-category") },
    { _id: "p6", name: "F", brandSlug: "other", categoryPath: ["cardio"], adminLocked: [], ...live() },
    { _id: "p7", name: "G", supplier: "manual", brandSlug: "aerofit", categoryPath: ["cardio"], adminLocked: [], ...live() },
  ];
  const byId = new Map(products.map((p) => [p._id, p]));
  t.mock.method(Product, "find", (query) => ({ lean: async () => products.filter((p) => matches(p, query)).map((p) => ({ ...p })) }));
  const writes = [];
  t.mock.method(Product, "bulkWrite", async (ops) => {
    writes.push(...ops);
    for (const { updateOne } of ops) {
      const p = byId.get(updateOne.filter._id);
      Object.assign(p, updateOne.update.$set);
      if (updateOne.update.$addToSet) p.adminLocked = [...new Set([...p.adminLocked, ...updateOne.update.$addToSet.adminLocked.$each])];
    }
  });
  t.mock.method(Product, "aggregate", async () => []);
  t.mock.method(Category, "find", findIn([{ slug: "yoga", isActive: false }, { slug: "cardio" }, { slug: "strength" }]));
  t.mock.method(Category, "bulkWrite", async () => ({}));
  t.mock.method(Brand, "find", findIn([]));
  t.mock.method(Brand, "bulkWrite", async () => ({}));

  await assert.rejects(adminProducts.bulkSetLive({ filters: {}, live: false }), /at least one filter/);

  const preview = await adminProducts.bulkSetLive({ filters: { brand: "aerofit" }, live: false, dryRun: true });
  assert.deepEqual(preview, { matched: 6, changed: 2, already: 4, waiting: 0, bySync: 0, dryRun: true });
  assert.equal(writes.length, 0, "a dry run changes nothing");

  await adminProducts.bulkSetLive({ filters: { brand: "aerofit" }, live: false });
  assert.deepEqual(state(byId.get("p1")), hidden("admin"));
  assert.deepEqual(byId.get("p1").adminLocked, ["isActive", "visibility", "hiddenBy"], "kept by the catalogue sync");
  assert.deepEqual(byId.get("p7").adminLocked, [], "added by hand: no locks");
  assert.deepEqual(state(byId.get("p6")), live(), "other brand untouched");

  const shown = await adminProducts.bulkSetLive({ filters: { brand: "aerofit" }, live: true });
  assert.deepEqual(shown, { matched: 6, changed: 3, already: 0, waiting: 2, bySync: 1, dryRun: false });
  assert.deepEqual(state(byId.get("p2")), live());
  assert.deepEqual(state(byId.get("p3")), hidden("admin-category"), "its category is hidden: comes back with it");
  assert.deepEqual(state(byId.get("p4")), hidden(""), "hidden by the sync: left alone");
});
