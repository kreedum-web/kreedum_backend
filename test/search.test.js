// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const Product = require("../src/models/Product");
const searchService = require("../src/services/searchService");

test("search suggestions: symbols typed by customers don't break the search", async () => {
  const filters = [];
  Product.find = (filter) => {
    filters.push(filter);
    return { limit: () => ({ lean: async () => [] }) };
  };

  for (const typed of ["tread\\", "bench (", "a+b", "[mat", "**"]) {
    await searchService.getSuggestions(typed);
    const { $regex, $options } = filters.at(-1).name;
    // Valid pattern that matches the text exactly as typed.
    assert.ok(new RegExp($regex, $options).test(`xx ${typed} yy`), typed);
  }

  assert.deepEqual(await searchService.getSuggestions("a"), []);
  assert.deepEqual(await searchService.getSuggestions(undefined), []);
});
