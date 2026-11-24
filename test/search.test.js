// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseQuery, parsePrice, termsOf, editDistance } = require("../src/utils/searchText");
const { buildIndex, searchIndex, resetIndex } = require("../src/services/searchIndex");
const Product = require("../src/models/Product");
const Category = require("../src/models/Category");

let n = 0;
const product = (name, brand, price, categoryPath = [], extra = {}) => ({
  _id: `p${++n}`,
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  brand,
  brandSlug: brand.toLowerCase(),
  sellingPrice: price,
  categoryPath,
  department: categoryPath[0],
  parentCategory: categoryPath[1] || "",
  childCategory: categoryPath[2] || "",
  searchKeywords: [],
  ...extra,
});

const catalogue = [
  product("USI-612 Boxing Gloves", "USI", 1569, ["accessories", "boxing-and-punching-bags", "boxing-mma-gloves"], { sku: "USI-612" }),
  product("Xpeed XP-3052 Matt PU Boxing Glove", "Xpeed", 1999, ["accessories", "boxing-and-punching-bags", "boxing-mma-gloves"]),
  product("USI-626N Boxing Bags", "USI", 3200, ["accessories", "boxing-and-punching-bags", "punching-bags"]),
  product("Aerofit AF-409 Home Fitness Treadmill", "Aerofit", 44249, ["cardio", "treadmills"], { sku: "AF-409" }),
  product("Aerofit AF-105 Commercial Treadmill", "Aerofit", 264379, ["cardio", "treadmills"]),
  product("Powermax TDM-98 Treadmill", "Powermax", 38999, ["cardio", "treadmills"]),
  product("Adjustable Expender", "Aerofit", 949, ["accessories", "tubes"], { sku: "AF-380TR" }),
  product("Aerofit AF-686U Magnetic Exercise Bike", "Aerofit", 13499, ["cardio", "exercise-bikes"]),
  product("Rubber Flooring Tile", "Aerofit", 0, ["flooring"]),
];
const categoryNames = new Map([
  ["treadmills", "Treadmills"],
  ["exercise-bikes", "Exercise Bikes"],
  ["boxing-mma-gloves", "Boxing & MMA Gloves"],
  ["punching-bags", "Punching Bags"],
]);
const index = buildIndex(catalogue, categoryNames);
const names = (query, filters) => searchIndex(index, query, filters).results.map((r) => r.product.name);

test("search text: capitals, dashes, plurals and model numbers", () => {
  assert.deepEqual(termsOf("USI-612 Boxing Gloves"), ["usi", "612", "boxing", "glove", "usi612"]);
  assert.deepEqual(parseQuery("Usi BOXING gloves").words, [["usi"], ["boxing"], ["glove"]]);
  assert.deepEqual(parseQuery("best treadmill for home").words, [["treadmill"], ["home"]]);
  assert.equal(editDistance("traedmill", "treadmill"), 1);
});

test("search text: price phrases", () => {
  const p = (q) => {
    const { text, minPrice, maxPrice } = parsePrice(q);
    return [text, minPrice, maxPrice];
  };
  assert.deepEqual(p("treadmill under 100000"), ["treadmill", undefined, 100000]);
  assert.deepEqual(p("treadmill below 1 lakh"), ["treadmill", undefined, 100000]);
  assert.deepEqual(p("dumbbells upto 5k"), ["dumbbells", undefined, 5000]);
  assert.deepEqual(p("bike between 10000 and 20000"), ["bike", 10000, 20000]);
  assert.deepEqual(p("bike 10k-20k"), ["bike", 10000, 20000]);
  assert.deepEqual(p("bike 10 to 20k"), ["bike", 10000, 20000]);
  assert.deepEqual(p("treadmill above 50,000"), ["treadmill", 50000, undefined]);
  assert.deepEqual(p("massage chair ₹80,000"), ["massage chair", undefined, 80000]);
  assert.deepEqual(p("af-409 treadmill"), ["af-409 treadmill", undefined, undefined]); // model numbers aren't prices
});

test("search: any word order and capitals ('Usi boxing gloves', 'boxing gloves usi')", () => {
  assert.deepEqual(names("Usi boxing gloves"), ["USI-612 Boxing Gloves"]);
  assert.deepEqual(names("boxing gloves usi"), ["USI-612 Boxing Gloves"]);
  assert.deepEqual(names("BOXING GLOVES"), ["USI-612 Boxing Gloves", "Xpeed XP-3052 Matt PU Boxing Glove"]);
});

test("search: typos are forgiven and reported ('Aerofit traedmill')", () => {
  const found = searchIndex(index, "Aerofit traedmill");
  assert.deepEqual(found.results.map((r) => r.product.name).sort(), ["Aerofit AF-105 Commercial Treadmill", "Aerofit AF-409 Home Fitness Treadmill"]);
  assert.deepEqual(found.corrections, [{ from: "traedmill", to: "treadmill" }]);
});

test("search: start of a word, model numbers and categories", () => {
  assert.equal(names("tread").length, 3);
  assert.deepEqual(names("AF-380TR"), ["Adjustable Expender"]);
  assert.deepEqual(names("af380tr"), ["Adjustable Expender"]);
  assert.deepEqual(names("exercise cycle"), ["Aerofit AF-686U Magnetic Exercise Bike"]); // cycle = bike
  // found by its category; the bags come before other things in "Boxing and Punching Bags"
  assert.equal(names("punching bags")[0], "USI-626N Boxing Bags");
});

test("search: price phrases filter and price-on-request products are left out", () => {
  assert.deepEqual(names("treadmill under 50000").sort(), ["Aerofit AF-409 Home Fitness Treadmill", "Powermax TDM-98 Treadmill"]);
  assert.deepEqual(names("treadmill above 1 lakh"), ["Aerofit AF-105 Commercial Treadmill"]);
  assert.deepEqual(names("under 1000"), ["Adjustable Expender"]); // no words: everything in the price range
  assert.ok(!names("flooring under 5000").length);
  // the page's own price filter wins over the typed one
  assert.deepEqual(names("treadmill under 50000", { maxPrice: "40000" }), ["Powermax TDM-98 Treadmill"]);
});

test("search: nothing matches every word → closest matches, marked relaxed", () => {
  const found = searchIndex(index, "usi treadmill gloves");
  assert.equal(found.relaxed, true);
  assert.ok(found.results.some((r) => r.product.name === "USI-612 Boxing Gloves"));
  assert.deepEqual(names("zzzz qqqq"), []);
});

test("search: filters and sorting still work", () => {
  assert.deepEqual(names("treadmill", { brand: "powermax" }), ["Powermax TDM-98 Treadmill"]);
  assert.deepEqual(names("treadmill", { sort: "price_low_high" }), [
    "Powermax TDM-98 Treadmill",
    "Aerofit AF-409 Home Fitness Treadmill",
    "Aerofit AF-105 Commercial Treadmill",
  ]);
});

test("search API and suggestions use the same search", async () => {
  resetIndex();
  const searchService = require("../src/services/searchService");
  const lean = (value) => ({ lean: async () => value });
  Product.find = (filter) => (filter?._id?.$in ? lean(catalogue.filter((p) => filter._id.$in.includes(p._id))) : lean(catalogue.filter((p) => p.sellingPrice || true)));
  Category.find = () => lean([...categoryNames].map(([slug, name]) => ({ slug, name })));
  // no spelling groups, no views / orders yet, searches not saved
  require("../src/models/SearchSynonym").find = () => lean([]);
  for (const model of ["Order", "Enquiry", "PageView"]) require(`../src/models/${model}`).aggregate = async () => [];
  require("../src/models/SearchLog").create = async () => ({});

  const result = await searchService.searchProducts({ q: "aerofit traedmill under 1 lakh", limit: "12" });
  assert.deepEqual(result.products.map((p) => p.name), ["Aerofit AF-409 Home Fitness Treadmill"]);
  assert.equal(result.pagination.totalProducts, 1);
  assert.equal(result.interpreted.maxPrice, 100000);
  assert.deepEqual(result.interpreted.corrections, [{ from: "traedmill", to: "treadmill" }]);

  const suggestions = await searchService.getSuggestions("Usi boxing");
  assert.deepEqual(suggestions.map((s) => s.name).sort(), ["USI-612 Boxing Gloves", "USI-626N Boxing Bags"]);
  assert.deepEqual(Object.keys(suggestions[0]).sort(), ["_id", "brand", "name", "sellingPrice", "slug", "thumbnail"]);
  // symbols typed by customers never break anything
  for (const typed of ["tread\\", "bench (", "a+b", "[mat", "**"]) await searchService.getSuggestions(typed);
});

test("search filters: several brands, and the filter panel's brands and price range", () => {
  const found = searchIndex(index, "treadmill", { brand: "aerofit,powermax" });
  assert.equal(found.results.length, 3);

  const aerofitOnly = searchIndex(index, "treadmill", { brand: ["aerofit"] });
  assert.deepEqual(aerofitOnly.results.map((r) => r.product.brandSlug), ["aerofit", "aerofit"]);
  // Brand counts are for every brand that matched, so others can be ticked too…
  assert.deepEqual(aerofitOnly.facets.brands.map((b) => [b.slug, b.count]), [["aerofit", 2], ["powermax", 1]]);
  // …and the price range is for the chosen brand.
  assert.deepEqual(aerofitOnly.facets.price, { min: 44200, max: 264400 });

  const cheap = searchIndex(index, "treadmill", { maxPrice: "50000" });
  assert.equal(cheap.results.length, 2);
  assert.deepEqual(cheap.facets.brands.map((b) => [b.slug, b.count]), [["aerofit", 1], ["powermax", 1]], "counts follow the price range");
  assert.deepEqual(cheap.facets.price, { min: 38900, max: 264400 }, "the slider keeps the full range");

  const none = searchIndex(index, "treadmill", { brand: "usi" });
  assert.equal(none.results.length, 0);
  assert.deepEqual(none.facets.brands.find((b) => b.slug === "usi"), { slug: "usi", name: "usi", count: 0 }, "a chosen brand can still be unticked");
});

test("products API: several brands and a price range", () => {
  const buildProductQuery = require("../src/utils/productQueryBuilder");
  const { brandList } = require("../src/utils/productFacets");
  assert.deepEqual(brandList(["aerofit,Powermax", "aerofit", " "]), ["aerofit", "powermax"]);
  assert.deepEqual(buildProductQuery({ brand: "aerofit" }).query.brandSlug, "aerofit");
  assert.deepEqual(buildProductQuery({ brand: "aerofit,usi" }).query.brandSlug, { $in: ["aerofit", "usi"] });
  assert.deepEqual(buildProductQuery({ minPrice: "1000", maxPrice: "5000" }).query.sellingPrice, { $gt: 0, $gte: 1000, $lte: 5000 });
  assert.equal(buildProductQuery({ minPrice: "" }).query.sellingPrice, undefined);
});
