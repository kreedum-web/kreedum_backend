// Search: admin spellings, descriptions, popularity, search log, popular searches. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildIndex, searchIndex } = require("../src/services/searchIndex");
const SearchLog = require("../src/models/SearchLog");
const SearchSetting = require("../src/models/SearchSetting");
const { recordSearch, popularSearches, clearPopularCache } = require("../src/services/searchInsights");
const adminSearch = require("../src/services/admin/adminSearchService");

const products = [
  { _id: "1", slug: "wp", name: "Aerofit Walking Pad WP-1", brand: "Aerofit", categoryPath: ["cardio"] },
  { _id: "2", slug: "walkpad", name: "Cockatoo Walkpad Smart", brand: "Cockatoo", categoryPath: ["cardio"] },
  { _id: "3", slug: "rope", name: "Nivia Skipping Rope", brand: "Nivia", categoryPath: ["fitness"] },
  {
    _id: "4", slug: "bench", name: "USI Flat Bench", brand: "USI", categoryPath: ["strength"],
    descriptionText: "Sturdy bench, great for home workouts with a skipping rope holder.",
  },
  { _id: "5", slug: "mat-a", name: "Yoga Mat Classic", brand: "Nivia", categoryPath: ["yoga"] },
  { _id: "6", slug: "mat-b", name: "Yoga Mat Classic Plus", brand: "Nivia", categoryPath: ["yoga"] },
];
const names = (found) => found.results.map((r) => r.product.name);

test("spellings from the admin: any one finds products using any of them, phrases too", () => {
  const groups = [
    { _id: "g1", phrases: ["walking pad", "walkpad", "walk pad"] },
    { _id: "g2", phrases: ["skipping rope", "jump rope"] },
  ];
  const index = buildIndex(products, new Map(), { groups });
  assert.deepEqual(names(searchIndex(index, "walkpad")).sort(), ["Aerofit Walking Pad WP-1", "Cockatoo Walkpad Smart"]);
  assert.deepEqual(names(searchIndex(index, "walking pads")).sort(), ["Aerofit Walking Pad WP-1", "Cockatoo Walkpad Smart"]);
  assert.deepEqual(names(searchIndex(index, "aerofit walk pad")), ["Aerofit Walking Pad WP-1"]);
  assert.equal(names(searchIndex(index, "jump rope"))[0], "Nivia Skipping Rope");
  assert.equal(searchIndex(index, "jump rope").relaxed, false, "a full match");
  // without the group, "jump rope" is only a partial match ("closest results")
  assert.equal(searchIndex(buildIndex(products), "jump rope").relaxed, true);
});

test("descriptions are searched, but rank below products whose name says it", () => {
  const index = buildIndex(products);
  const found = names(searchIndex(index, "skipping rope"));
  assert.deepEqual(found, ["Nivia Skipping Rope", "USI Flat Bench"]);
  assert.deepEqual(names(searchIndex(index, "sturdy")), ["USI Flat Bench"]);
  // a typo is never "corrected" to a word found only in a description
  assert.deepEqual(searchIndex(index, "sturdi").corrections, []);
});

test("among equal matches, products customers view and buy come first", () => {
  const plain = buildIndex(products);
  assert.equal(names(searchIndex(plain, "yoga mat classic"))[0], "Yoga Mat Classic");
  const popular = buildIndex(products, new Map(), { popularity: new Map([["mat-b", 300]]) });
  assert.equal(names(searchIndex(popular, "yoga mat classic"))[0], "Yoga Mat Classic Plus");
  // popularity never beats a better word match
  assert.equal(names(searchIndex(popular, "walking pad"))[0], "Aerofit Walking Pad WP-1");
});

test("searches are recorded once: not again when a filter or page changes", (t) => {
  const saved = [];
  t.mock.method(SearchLog, "create", async (doc) => saved.push(doc));
  recordSearch({ text: "  Aerofit  TREADMILL ", results: 12, relaxed: false });
  recordSearch({ text: "aerofit treadmill", results: 3, page: 2 });
  recordSearch({ text: "aerofit treadmill", results: 3, filtered: true });
  recordSearch({ text: "x", results: 0 });
  assert.deepEqual(saved, [{ term: "aerofit treadmill", text: "Aerofit  TREADMILL", results: 12, relaxed: false }]);
});

test("popular searches: pinned first, then real searches (not hidden), then starter ones", async (t) => {
  clearPopularCache();
  t.mock.method(SearchSetting, "findOne", () => ({ lean: async () => ({ pinned: ["Walking Pad"], hidden: ["treadmil"] }) }));
  t.mock.method(SearchLog, "aggregate", async () => [{ _id: "treadmil", count: 9 }, { _id: "yoga mat", count: 5 }, { _id: "walking pad", count: 4 }]);
  const list = await popularSearches();
  assert.deepEqual(list.slice(0, 4), ["Walking Pad", "Yoga Mat", "Aerofit Treadmill", "Multi Gym"]);
  assert.equal(list.length, 8);
  clearPopularCache();
});

test("admin spellings: checked and tidied", async (t) => {
  const SearchSynonym = require("../src/models/SearchSynonym");
  t.mock.method(SearchSynonym, "findOne", () => ({ lean: async () => null }));
  t.mock.method(SearchSynonym, "create", async (doc) => ({ _id: "g1", ...doc }));
  const group = await adminSearch.createSynonym({ phrases: ["Walking Pad", " walkpad ", "walking pad", ""] });
  assert.deepEqual(group.phrases, ["walking pad", "walkpad"]);
  await assert.rejects(adminSearch.createSynonym({ phrases: ["walkpad"] }), /at least two/);

  t.mock.method(SearchSynonym, "findOne", () => ({ lean: async () => ({ phrases: ["walkpad", "walking pad"] }) }));
  await assert.rejects(adminSearch.createSynonym({ phrases: ["walkpad", "treadmill pad"] }), /already in the group/);
});
