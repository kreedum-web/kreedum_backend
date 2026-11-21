// Aerofit / Cockatoo products from the scraper's catalog_feed. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { planRebuild } = require("../src/migration/rebuildCatalog");
const { withCategoryRules } = require("../src/utils/categoryRules");

const categories = [
  { slug: "cardio", name: "Cardio", level: 1, path: ["cardio"], displayOrder: 0 },
  { slug: "treadmill", name: "Treadmills", level: 2, parentSlug: "cardio", path: ["cardio", "treadmill"] },
  {
    slug: "domestic-treadmill",
    name: "Domestic Treadmill",
    level: 3,
    parentSlug: "treadmill",
    path: ["cardio", "treadmill", "domestic-treadmill"],
  },
  { slug: "sports", name: "Sports", level: 1, path: ["sports"], displayOrder: 6 },
  { slug: "accessories", name: "Accessories", level: 1, path: ["accessories"], displayOrder: 4 },
  { slug: "boxing-and-punching-bags", name: "Boxing", level: 2, parentSlug: "accessories", path: ["accessories", "boxing-and-punching-bags"] },
  { slug: "home-gym", name: "Home Gym", level: 2, parentSlug: "accessories", path: ["accessories", "home-gym"] },
];

const metro = {
  _id: "m1",
  supplier: "metrosports",
  url: "https://metrosports.co.in/product/af-504/",
  name: "Aerofit AF-504 Treadmill",
  sku: "AF-504",
  brand: "Aerofit",
  categorySlug: "domestic-treadmill",
  status: "active",
  sellingPrice: 49999,
  mrp: 59999,
};
const goggles = {
  _id: "f1",
  supplier: "aerofit",
  url: "https://aerofit.co/product/swimming-goggles-1133/",
  name: "Aerofit Swimming Goggles 1133 WHALE",
  sku: "",
  brand: "Aerofit",
  categorySlug: "swimming",
  status: "active",
  sellingPrice: 650,
  mrp: 800,
  features: ["Anti-fog lenses", "Warranty: 6 months"],
};
const shoe = {
  _id: "f2",
  supplier: "cockatoo",
  url: "https://www.cockatooindia.com/products/dynamic-running-shoe",
  name: "Cockatoo Dynamic Running Shoe",
  brand: "Cockatoo",
  categorySlug: "shoes",
  status: "active",
  sellingPrice: 899,
  mrp: 2599,
};
const enquiry = {
  ...goggles,
  _id: "f3",
  url: "https://aerofit.co/product/af-125/",
  name: "Aerofit AF-125 Motorized Treadmill",
  categorySlug: "domestic-treadmill",
  sellingPrice: 0,
  mrp: 0,
};

const plan = (supplierProducts, existingProducts = []) =>
  planRebuild({ supplierCategories: categories, supplierProducts, existingProducts });

test("new categories from categoryRules.js, including the top-level Shoes", () => {
  const { categories: all, problems } = withCategoryRules(categories);
  assert.deepEqual(problems.filter((p) => /swimming|badminton|cricket|other-sports|shoes/.test(p)), []);
  const by = new Map(all.map((c) => [c.slug, c]));
  assert.deepEqual(by.get("swimming").path, ["sports", "swimming"]);
  assert.equal(by.get("swimming").level, 2);
  assert.deepEqual(by.get("shoes").path, ["shoes"]);
  assert.equal(by.get("shoes").level, 1);
  assert.equal(by.get("shoes").rootSlug, "shoes");
  assert.ok(by.get("shoes").displayOrder > 6); // after Metro's departments
});

test("catalog_feed products are published with their own supplier and category", () => {
  const p = plan([metro, goggles, shoe]);
  const set = (url) => p.products.find((x) => x.sp.url === url).update.$set;
  assert.equal(set(metro.url).supplier, "metrosports");
  assert.equal(set(goggles.url).supplier, "aerofit");
  assert.deepEqual(set(goggles.url).categoryPath, ["sports", "swimming"]);
  assert.equal(set(goggles.url).visibility, "published");
  assert.equal(set(goggles.url).specifications.Warranty, "6 months");
  assert.equal(set(shoe.url).supplier, "cockatoo");
  assert.equal(set(shoe.url).department, "shoes");
  assert.equal(set(shoe.url).visibility, "published");
  assert.deepEqual(p.summary.productsBySupplier, { metrosports: 1, aerofit: 1, cockatoo: 1 });
});

test("no price -> sold on enquiry", () => {
  const set = plan([metro, enquiry]).products.find((x) => x.sp.url === enquiry.url).update.$set;
  assert.equal(set.stockStatus, "enquiry_only");
  assert.equal(set.sellingPrice, 0);
});

test("only suppliers in this run hide their missing products", () => {
  const existing = [
    { _id: "e1", supplier: "metrosports", sourceUrl: "https://metrosports.co.in/product/gone/", isActive: true, visibility: "published" },
    { _id: "e2", supplier: "aerofit", sourceUrl: "https://aerofit.co/product/dropped/", isActive: true, visibility: "published" },
    { _id: "e3", supplier: "cockatoo", sourceUrl: "https://www.cockatooindia.com/products/kept", isActive: true, visibility: "published" },
  ];
  // Metro + Aerofit in the run, no Cockatoo at all (e.g. feed built without it).
  const removed = plan([metro, goggles], existing).removed.map((p) => p._id);
  assert.deepEqual(removed.sort(), ["e1", "e2"]);
  // Metro only (catalog_feed empty / not built): Aerofit and Cockatoo products stay.
  assert.deepEqual(plan([metro], existing).removed.map((p) => p._id), ["e1"]);
});

test("a product already on the website keeps its web address when a new one has the same name", () => {
  const twin = { ...goggles, url: "https://aerofit.co/product/af-504-copy/", name: metro.name, sku: metro.sku, categorySlug: "domestic-treadmill" };
  const existingSlug = "aerofit-af-504-treadmill-af-504";
  const p = plan([twin, metro], [{ _id: "e1", supplier: "metrosports", sourceUrl: metro.url, slug: existingSlug, isActive: true }]);
  const slugOf = (url) => p.products.find((x) => x.sp.url === url).update.$set.slug;
  assert.equal(slugOf(metro.url), existingSlug);
  assert.notEqual(slugOf(twin.url), existingSlug);
  // Without existing products, Metro still wins over the feed.
  const fresh = plan([twin, metro]);
  assert.equal(fresh.products.find((x) => x.sp.url === metro.url).update.$set.slug, existingSlug);
});
