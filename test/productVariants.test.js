// Products sold in versions (weight, size…). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { hasVariants, resolveVariant, variantsFromSupplier, pricing } = require("../src/utils/productVariants");

test("a single version with no options (Cockatoo treadmill / spin bike) is sold as one item", () => {
  // as the scraper gives it: Shopify's one hidden "Default Title" version
  const sp = { options: [], variants: [{ variantId: "47305983688999", options: {}, label: "", mrp: 30999, sellingPrice: 16990, inStock: true }] };
  assert.deepEqual(variantsFromSupplier(sp, 16990), { options: [], variants: [], maxPrice: 16990 });

  // and products already saved that way: no choice needed in the cart
  const saved = { name: "SPIN BIKE CSB 720", sellingPrice: 16990, mrp: 30999, options: [], variants: sp.variants };
  assert.equal(hasVariants(saved), false);
  assert.equal(resolveVariant(saved, ""), null);
  assert.equal(pricing(saved, null).sellingPrice, 16990);
});

test("products with real options still need one chosen", () => {
  const dumbbell = {
    options: [{ name: "Weight", values: ["5 kg", "10 kg"] }],
    variants: [
      { variantId: "a", options: { Weight: "5 kg" }, sellingPrice: 1249, mrp: 1500 },
      { variantId: "b", options: { Weight: "10 kg" }, sellingPrice: 2499, mrp: 3000 },
    ],
  };
  assert.equal(hasVariants(dumbbell), true);
  assert.throws(() => resolveVariant(dumbbell, ""), /Please choose weight first/);
  assert.equal(resolveVariant(dumbbell, "b").sellingPrice, 2499);
  assert.equal(variantsFromSupplier(dumbbell, 1249).variants.length, 2);
});
