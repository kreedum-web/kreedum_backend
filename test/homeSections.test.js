// Home page product rows and related products. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { chooseProducts, isShowing, dailyShuffle } = require("../src/services/homeSectionsService");
const { pickRelated, familyOf } = require("../src/utils/relatedProducts");

let n = 0;
const product = (fields = {}) => ({
  _id: `p${++n}`,
  name: `Product ${n}`,
  slug: `product-${n}`,
  brandSlug: "aerofit",
  thumbnail: "x.jpg",
  sellingPrice: 1000,
  discountPercent: 10,
  createdAt: new Date(2026, 0, n),
  ...fields,
});
const inputs = (products, popularity = {}) => ({
  products,
  byId: new Map(products.map((p) => [String(p._id), p])),
  popularity: { bestseller: new Map(), trending: new Map(), ...popularity },
  day: "2026-11-24",
});
const names = (rows) => rows.map((r) => r.product.name);

test("a row shows the admin's picks first, then its rule", () => {
  const products = [
    product({ name: "Viewed a lot", slug: "hot" }),
    product({ name: "Ticked trending", isTrending: true }),
    product({ name: "Viewed a bit", slug: "warm", brandSlug: "usi" }),
    product({ name: "Not viewed" }),
  ];
  const trending = new Map([["hot", 50], ["warm", 5]]);
  const rows = chooseProducts({ rule: "trending", limit: 3 }, inputs(products, { trending }));
  assert.deepEqual(names(rows), ["Ticked trending", "Viewed a lot", "Viewed a bit"]);
  assert.deepEqual(rows.map((r) => r.picked), [true, false, false]);
});

test("rows don't repeat filled products from rows above, and mix brands", () => {
  const products = [
    ...Array.from({ length: 4 }, (_, i) => product({ name: `Aerofit ${i}`, discountPercent: 50 - i })),
    product({ name: "USI", brandSlug: "usi", discountPercent: 5 }),
    product({ name: "No photo", thumbnail: "", discountPercent: 90 }),
  ];
  const used = new Set();
  const first = chooseProducts({ rule: "featured", limit: 3 }, { ...inputs(products), used });
  assert.deepEqual(names(first), ["Aerofit 0", "Aerofit 1", "USI"], "at most 2 per brand while others are left; no product without a photo");
  const second = chooseProducts({ rule: "featured", limit: 3 }, { ...inputs(products), used });
  assert.deepEqual(names(second), ["Aerofit 2", "Aerofit 3"], "nothing shown above again");
});

test("today's deals: Hot Deal first, priced products on sale only, same order all day", () => {
  const products = [
    product({ name: "On request", sellingPrice: 0, discountPercent: 60 }),
    product({ name: "No discount", discountPercent: 0 }),
    product({ name: "Hot", badge: "Hot Deal", discountPercent: 5 }),
    ...Array.from({ length: 6 }, (_, i) => product({ name: `Sale ${i}`, discountPercent: 30 + i, brandSlug: `b${i}` })),
  ];
  const rows = chooseProducts({ rule: "deals", limit: 5 }, inputs(products));
  assert.equal(rows[0].product.name, "Hot");
  assert.ok(rows.every((r) => !["On request", "No discount"].includes(r.product.name)));
  assert.deepEqual(names(chooseProducts({ rule: "deals", limit: 5 }, inputs(products))), names(rows), "stable within a day");
  assert.notDeepEqual(dailyShuffle([1, 2, 3, 4, 5, 6, 7, 8], "2026-11-24"), dailyShuffle([1, 2, 3, 4, 5, 6, 7, 8], "2026-11-25"));
});

test("ready stock row: only products marked ready stock", () => {
  const products = [product({ name: "In store", readyStock: true }), product({ name: "Supplier only" })];
  assert.deepEqual(names(chooseProducts({ rule: "ready-stock", limit: 8 }, inputs(products))), ["In store"]);
});

test("custom row (e.g. Summer): picks, then its category / price / brand rule", () => {
  const swim = (fields) => product({ categoryPath: ["sports", "swimming"], ...fields });
  const products = [
    swim({ name: "Goggles", sellingPrice: 500, brandSlug: "speedo" }),
    swim({ name: "Pool float", sellingPrice: 5000, brandSlug: "intex" }),
    product({ name: "Treadmill", categoryPath: ["cardio"] }),
    product({ name: "Picked cap", _id: "cap" }),
  ];
  const section = {
    rule: "custom",
    limit: 8,
    productIds: ["cap"],
    filters: { categorySlug: "swimming", maxPrice: 1000, sort: "price_low" },
  };
  assert.deepEqual(names(chooseProducts(section, inputs(products))), ["Picked cap", "Goggles"]);
  assert.deepEqual(names(chooseProducts({ ...section, autoFill: false }, inputs(products))), ["Picked cap"]);
});

test("seasonal rows show only between their dates", () => {
  const now = new Date("2026-05-10");
  assert.equal(isShowing({ isVisible: true, startsAt: "2026-04-01", endsAt: "2026-06-30" }, now), true);
  assert.equal(isShowing({ isVisible: true, startsAt: "2026-06-01" }, now), false);
  assert.equal(isShowing({ isVisible: true, endsAt: "2026-05-01" }, now), false);
  assert.equal(isShowing({ isVisible: false }, now), false);
});

test("related products: one per family, never the product's own family, nearest price first", () => {
  const current = { _id: "me", name: "Aerofit Hex Dumbbell 5 Kg", slug: "me", sellingPrice: 2000 };
  const candidates = [
    { _id: "a", name: "Aerofit Hex Dumbbell 10 Kg", slug: "a", sellingPrice: 4000, brandSlug: "aerofit" },
    { _id: "b", name: "Kettlebell 8 Kg", slug: "b", sellingPrice: 2500, brandSlug: "aerofit" },
    { _id: "c", name: "Kettlebell 12 Kg", slug: "c", sellingPrice: 3500, brandSlug: "aerofit" },
    { _id: "d", name: "Weight Plate Rack", slug: "d", sellingPrice: 20000, brandSlug: "usi" },
    { _id: "e", name: "Gym Gloves (Black)", slug: "e", sellingPrice: 1800, brandSlug: "nivia" },
  ];
  assert.deepEqual(pickRelated(current, candidates).map((p) => p._id), ["e", "b", "d"]);
  assert.equal(familyOf("Aerofit AF-404 Treadmill") === familyOf("Aerofit AF-409 Treadmill"), false, "different models stay apart");
});
