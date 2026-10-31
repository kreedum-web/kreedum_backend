// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  productImageUrls,
  isOwnImage,
  publicIdFor,
  assignPublicIds,
  deliveryUrl,
  withOwnImages,
} = require("../src/utils/productImages");

const METRO = "https://metrosports.co.in/wp-content/uploads";
const OURS = (id) => `https://res.cloudinary.com/kreedum/image/upload/f_auto,q_auto,c_limit,w_1200/v1/${id}`;

const product = {
  thumbnail: `${METRO}/2025/09/a.png`,
  images: [`${METRO}/2025/09/a.png`, `${METRO}/2025/09/b.webp`],
  variants: [
    { variantId: "1", image: `${METRO}/2025/09/c.png`, sellingPrice: 100 },
    { variantId: "2", image: "", sellingPrice: 200 },
  ],
};

test("collects every photo a product uses, once", () => {
  assert.deepEqual(productImageUrls(product), [`${METRO}/2025/09/a.png`, `${METRO}/2025/09/b.webp`, `${METRO}/2025/09/c.png`]);
  assert.deepEqual(productImageUrls({ thumbnail: "/images/local.png", images: [] }), []);
});

test("Cloudinary names mirror the supplier's upload path", () => {
  assert.equal(
    publicIdFor(`${METRO}/2025/09/Untitled-design-2025-09-04T115924.906.png`),
    "kreedum/products/2025/09/untitled-design-2025-09-04t115924-906"
  );
  assert.equal(publicIdFor(`${METRO}/2024/08/1.-AEROFIT-AF-439%20Treadmill.png`), "kreedum/products/2024/08/1-aerofit-af-439-treadmill");
  assert.match(publicIdFor("https://cdn.example.com/x.png"), /^kreedum\/products\/other\/[0-9a-f]{16}$/);
});

test("two files with the same cleaned name never share a Cloudinary name", () => {
  const ids = assignPublicIds([`${METRO}/2025/01/A.png`, `${METRO}/2025/01/A.jpg`]);
  assert.equal(ids.get(`${METRO}/2025/01/A.png`), "kreedum/products/2025/01/a");
  assert.match(ids.get(`${METRO}/2025/01/A.jpg`), /^kreedum\/products\/2025\/01\/a-[0-9a-f]{8}$/);

  // also against photos uploaded in an earlier run
  const later = assignPublicIds([`${METRO}/2025/01/a.gif`], new Map([["kreedum/products/2025/01/a", `${METRO}/2025/01/A.png`]]));
  assert.match(later.get(`${METRO}/2025/01/a.gif`), /-[0-9a-f]{8}$/);
});

test("customers get WebP/AVIF at most 1200px; adding it twice does nothing", () => {
  const raw = "https://res.cloudinary.com/kreedum/image/upload/v17/kreedum/products/2025/09/a.png";
  const url = deliveryUrl(raw);
  assert.equal(url, "https://res.cloudinary.com/kreedum/image/upload/f_auto,q_auto,c_limit,w_1200/v17/kreedum/products/2025/09/a.png");
  assert.equal(deliveryUrl(url), url);
  assert.ok(isOwnImage(url));
  assert.ok(!isOwnImage(`${METRO}/a.png`));
});

test("uploaded photos replace the supplier's; others stay until uploaded", () => {
  const map = new Map([
    [`${METRO}/2025/09/a.png`, OURS("a")],
    [`${METRO}/2025/09/c.png`, OURS("c")],
  ]);
  const swapped = withOwnImages(product, map);
  assert.equal(swapped.thumbnail, OURS("a"));
  assert.deepEqual(swapped.images, [OURS("a"), `${METRO}/2025/09/b.webp`]);
  assert.equal(swapped.variants[0].image, OURS("c"));
  assert.equal(swapped.variants[1].image, "");
  assert.equal(swapped.variants[0].sellingPrice, 100);
  assert.equal(withOwnImages(product, new Map()), product);
});

test("catalogue rebuild keeps our copies instead of putting the supplier's back", () => {
  const { planRebuild } = require("../src/migration/rebuildCatalog");
  const sp = {
    _id: "s1",
    url: "https://metrosports.co.in/product/dumbbells/",
    name: "Hex Dumbbells",
    sku: "HD-1",
    brand: "Aerofit",
    categorySlug: "dumbbells",
    status: "active",
    sellingPrice: 499,
    mrp: 500,
    ...product,
    options: [{ name: "Weight", values: ["1 kg", "2 kg"] }],
    variants: [
      { variantId: "1", options: { Weight: "1 kg" }, sellingPrice: 499, mrp: 500, image: `${METRO}/2025/09/c.png` },
      { variantId: "2", options: { Weight: "2 kg" }, sellingPrice: 999, mrp: 1000, image: "" },
    ],
  };
  const plan = planRebuild({
    supplierCategories: [
      { slug: "weights-bars", name: "Weights & Bars", level: 1, path: ["weights-bars"] },
      { slug: "dumbbells", name: "Dumbbells", level: 2, parentSlug: "weights-bars", path: ["weights-bars", "dumbbells"] },
    ],
    supplierProducts: [sp],
    imageMap: new Map([
      [`${METRO}/2025/09/a.png`, OURS("a")],
      [`${METRO}/2025/09/c.png`, OURS("c")],
    ]),
  });
  const set = plan.products[0].update.$set;
  assert.equal(set.thumbnail, OURS("a"));
  assert.deepEqual(set.images, [OURS("a"), `${METRO}/2025/09/b.webp`]);
  assert.equal(set.variants[0].image, OURS("c"));
  assert.equal(plan.summary.photosNotInOwnStorage, 1); // b.webp not uploaded yet
});

test("upload run points products at the copies and skips unchanged ones", async () => {
  const Product = require("../src/models/Product");
  const writes = [];
  Product.bulkWrite = async (operations) => writes.push(...operations);

  const { rewriteProducts } = require("../src/migration/uploadImages");
  const products = [
    { _id: "p1", ...product },
    { _id: "p2", thumbnail: OURS("x"), images: [OURS("x")], variants: [] },
  ];
  const changed = await rewriteProducts(products, new Map([[`${METRO}/2025/09/a.png`, OURS("a")]]));

  assert.equal(changed, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].updateOne.filter._id, "p1");
  assert.equal(writes[0].updateOne.update.$set.thumbnail, OURS("a"));
  assert.deepEqual(writes[0].updateOne.update.$set.images, [OURS("a"), `${METRO}/2025/09/b.webp`]);
});
