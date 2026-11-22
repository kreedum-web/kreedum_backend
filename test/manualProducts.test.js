// Products added by hand in the admin dashboard. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const Product = require("../src/models/Product");
const Brand = require("../src/models/Brand");
const Category = require("../src/models/Category");
const adminProducts = require("../src/services/admin/adminProductService");
const { planRebuild } = require("../src/migration/rebuildCatalog");

const walkingPads = { slug: "walking-pads", name: "Walking Pads", level: 2, path: ["cardio", "walking-pads"] };
const lean = (value) => ({ lean: async () => value });

/** In-memory Product / Brand / Category for one test. */
function fakeDatabase(t, { brands = [], categories = [walkingPads] } = {}) {
  const products = new Map();
  const calls = { brandCreated: [], categoryInc: [], deleted: [] };
  t.mock.method(Product, "exists", async ({ slug }) => [...products.values()].some((p) => p.slug === slug));
  t.mock.method(Product, "create", async (fields) => {
    const product = { _id: `64b00000000000000000${String(products.size + 1).padStart(4, "0")}`, ...fields };
    product.save = async () => product;
    products.set(product._id, product);
    return product;
  });
  t.mock.method(Product, "findById", (id) => {
    const product = products.get(String(id)) || null;
    const result = Promise.resolve(product);
    result.lean = async () => (product ? { ...product } : null);
    return result;
  });
  t.mock.method(Product, "deleteOne", async ({ _id }) => {
    calls.deleted.push(String(_id));
    products.delete(String(_id));
  });
  t.mock.method(Brand, "findOne", ({ slug }) => lean(brands.find((b) => b.slug === slug) || null));
  t.mock.method(Brand, "create", async (b) => calls.brandCreated.push(b));
  t.mock.method(Brand, "updateOne", async () => ({}));
  t.mock.method(Category, "findOne", ({ slug }) => lean(categories.find((c) => c.slug === slug) || null));
  t.mock.method(Category, "find", () => lean(categories));
  t.mock.method(Category, "updateMany", async (filter, update) => calls.categoryInc.push([filter.slug.$in, update.$inc.productCount]));
  return { products, calls };
}

test("add a product by hand: live in its category, specs from feature lines, no locks", async (t) => {
  const { calls } = fakeDatabase(t, { brands: [{ slug: "aerofit", name: "Aerofit" }] });
  const product = await adminProducts.create({
    name: "Aerofit Walking Pad WP-1",
    brand: "aerofit",
    categorySlug: "walking-pads",
    sellingPrice: "24999",
    mrp: "29999",
    sku: "WP-1",
    descriptionText: "Compact walking pad for home.",
    features: "Motor: 2 HP\n• Foldable\nWarranty: 1 year",
  });
  assert.equal(product.manual, true);
  assert.equal(product.live, true);
  assert.equal(product.brand, "Aerofit", "an existing brand keeps its own spelling");
  assert.deepEqual(product.categoryPath, ["cardio", "walking-pads"]);
  assert.equal(product.slug, "aerofit-walking-pad-wp-1-wp-1");
  assert.equal(product.stockStatus, "in_stock");
  assert.deepEqual(product.adminLocked, [], "nothing to protect from the rebuild");
  assert.deepEqual(product.features, ["Motor: 2 HP", "Foldable", "Warranty: 1 year"]);
  assert.deepEqual(calls.categoryInc, [[["cardio", "walking-pads"], 1]], "menu counts include it");

  const saved = await Product.findById(product.id);
  assert.equal(saved.supplier, "manual");
  assert.equal(saved.discountPercent, 17);
  assert.equal(saved.warranty, "1 year");
  assert.equal(saved.specifications.Motor, "2 HP");
  assert.ok(saved.searchKeywords.includes("walking pads"));
  assert.match(saved.seo.description, /Compact walking pad/);
});

test("added by hand without a price: price on enquiry; a new brand is created", async (t) => {
  const { calls } = fakeDatabase(t);
  const product = await adminProducts.create({ name: "Court Flooring", brand: "Kreedum", categorySlug: "walking-pads", live: false });
  assert.equal(product.sellingPrice, 0);
  assert.equal(product.stockStatus, "enquiry_only");
  assert.equal(product.live, false);
  assert.deepEqual(calls.brandCreated.map((b) => b.slug), ["kreedum"]);
});

test("adding by hand: a wrong category or a missing brand leaves nothing behind", async (t) => {
  const { products, calls } = fakeDatabase(t);
  await assert.rejects(adminProducts.create({ name: "Mat", brand: "Kreedum", categorySlug: "nope" }), /Category not found/);
  assert.equal(products.size, 0);
  assert.equal(calls.deleted.length, 1);
  await assert.rejects(adminProducts.create({ name: "Mat", categorySlug: "walking-pads" }), /brand/);
  await assert.rejects(adminProducts.create({ name: "M", brand: "Kreedum", categorySlug: "walking-pads" }), /too short/);
});

test("delete: only products added by hand", async (t) => {
  const { products } = fakeDatabase(t);
  const mine = await adminProducts.create({ name: "Skipping Rope", brand: "Kreedum", categorySlug: "walking-pads" });
  await adminProducts.remove(mine.id);
  assert.equal(products.size, 0);

  const metro = await Product.create({ supplier: "metrosports", name: "Metro Mat", slug: "metro-mat", isActive: true, visibility: "published" });
  await assert.rejects(adminProducts.remove(metro._id), /Hide this one instead/);
});

test("edit a hand-made product's description and features; supplier products can't", async (t) => {
  fakeDatabase(t);
  const mine = await adminProducts.create({ name: "Skipping Rope", brand: "Kreedum", categorySlug: "walking-pads" });
  const edited = await adminProducts.update(mine.id, { descriptionText: "Steel cable.", features: ["Length: 3 m"] });
  assert.equal(edited.descriptionText, "Steel cable.");
  assert.deepEqual(edited.features, ["Length: 3 m"]);
  assert.deepEqual(edited.adminLocked, []);

  const metro = await Product.create({ supplier: "metrosports", name: "Metro Mat", slug: "metro-mat", features: ["A"], adminLocked: [] });
  const after = await adminProducts.update(metro._id, { features: ["B"] });
  assert.deepEqual(after.features, ["A"], "supplier text comes from the supplier");
});

test("catalogue rebuild leaves hand-made products alone and counts them in the menu", () => {
  const supplierCategories = [
    { slug: "cardio", name: "Cardio", level: 1, path: ["cardio"] },
    { slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", path: ["cardio", "treadmill"] },
  ];
  const handMade = {
    _id: "h1", supplier: "manual", sourceUrl: "", slug: "skipping-rope", isActive: true, visibility: "published",
    brand: "Kreedum", brandSlug: "kreedum", categoryPath: ["cardio", "treadmill"], adminLocked: [],
  };
  const plan = planRebuild({
    supplierCategories,
    supplierProducts: [
      { _id: "m1", supplier: "metrosports", url: "https://metro/x", name: "Treadmill X", brand: "Aerofit", categorySlug: "treadmill", status: "active", sellingPrice: 100 },
    ],
    existingProducts: [handMade],
  });
  assert.equal(plan.removed.length, 0, "never hidden");
  assert.ok(!plan.products.some((p) => p.existing?._id === "h1"), "never rebuilt");
  assert.equal(plan.categories.find((c) => c.slug === "treadmill").productCount, 2);
  assert.deepEqual(plan.brands.find((b) => b.slug === "kreedum"), { slug: "kreedum", name: "Kreedum", productCount: 1 });
  assert.ok(!plan.staleBrands.includes("kreedum"), "its brand stays on");
  assert.equal(plan.summary.untouchedProducts, 1);
});
