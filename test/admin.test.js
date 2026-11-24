// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const User = require("../src/models/User");
const Order = require("../src/models/Order");
const Product = require("../src/models/Product");
const Brand = require("../src/models/Brand");
const Category = require("../src/models/Category");

const ADMIN = { _id: "64b0000000000000000000a1", email: "owner@kreedum.com", role: "admin", isActive: true, firstName: "Owner" };
const CUSTOMER = { _id: "64b0000000000000000000c1", email: "asha@gmail.com", role: "customer", isActive: true };
const DISABLED_ADMIN = { _id: "64b0000000000000000000a2", email: "old@kreedum.com", role: "admin", isActive: false };
const accounts = [ADMIN, CUSTOMER, DISABLED_ADMIN];
User.findById = async (id) => accounts.find((a) => a._id === String(id)) || null;

const { nextStatuses } = require("../src/services/admin/adminOrderService");
const adminOrders = require("../src/services/admin/adminOrderService");
const adminProducts = require("../src/services/admin/adminProductService");
const { keepAdminChoices } = require("../src/migration/rebuildCatalog");
const { deviceOf, referrerHost, cleanPath, indiaDay, recordView } = require("../src/services/trackingService");
const PageView = require("../src/models/PageView");
const app = require("../src/app");

const tokenFor = (user) => jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = body ? JSON.stringify(body) : "";
      const req = http.request(
        {
          port: server.address().port, path, method,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(data),
            "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
          });
        }
      );
      req.on("error", (e) => { server.close(); reject(e); });
      req.end(data);
    });
  });
}

// ------------------------------------------------------------------ access

test("admin API: no sign-in → 401, customer → 403, disabled admin → 403, admin → 200", async () => {
  assert.equal((await request("GET", "/api/v1/admin/me")).status, 401);
  assert.equal((await request("GET", "/api/v1/admin/me", { token: tokenFor(CUSTOMER) })).status, 403);
  assert.equal((await request("GET", "/api/v1/admin/me", { token: tokenFor(DISABLED_ADMIN) })).status, 403);
  const ok = await request("GET", "/api/v1/admin/me", { token: tokenFor(ADMIN) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.email, "owner@kreedum.com");
});

test("admin API: a customer can't change an order's status", async () => {
  const res = await request("PATCH", "/api/v1/admin/orders/64b0000000000000000000f1/status", {
    token: tokenFor(CUSTOMER), body: { status: "SHIPPED" },
  });
  assert.equal(res.status, 403);
});

// ------------------------------------------------------------------ orders

test("order status: moves forward only, cancel until delivery, return after", () => {
  assert.deepEqual(nextStatuses({ orderStatus: "PENDING" }), ["CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);
  assert.deepEqual(nextStatuses({ orderStatus: "SHIPPED" }), ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);
  assert.deepEqual(nextStatuses({ orderStatus: "DELIVERED" }), ["RETURNED"]);
  assert.deepEqual(nextStatuses({ orderStatus: "AWAITING_PAYMENT" }), ["CANCELLED"]);
  assert.deepEqual(nextStatuses({ orderStatus: "CANCELLED" }), []);
  assert.deepEqual(nextStatuses({ orderStatus: "RETURNED" }), []);
});

function fakeOrder(fields) {
  const order = {
    _id: "64b0000000000000000000f1", orderNumber: "KRD-20261118-0001", user: CUSTOMER._id,
    paymentMethod: "COD", paymentStatus: "PENDING", orderStatus: "PENDING", statusHistory: [], adminSeenAt: null,
    pricing: { total: 1499 }, items: [{ name: "Yoga Mat", quantity: 1 }], shippingAddress: { fullName: "Asha" },
    ...fields,
  };
  order.save = async () => { saved.push(JSON.parse(JSON.stringify(order))); return order; };
  return order;
}
let saved = [];

test("order status: delivering a COD order marks it paid; going backwards is refused", async (t) => {
  saved = [];
  const order = fakeOrder({ orderStatus: "SHIPPED" });
  t.mock.method(Order, "findById", (id) => {
    const result = Promise.resolve(order);
    result.populate = () => ({ lean: async () => ({ ...order }) });
    return result;
  });
  t.mock.method(Order, "updateOne", async () => ({}));

  await assert.rejects(adminOrders.updateStatus(order._id, { status: "PACKED" }), /can't be marked PACKED/);

  await adminOrders.updateStatus(order._id, { status: "DELIVERED" });
  assert.equal(saved.at(-1).orderStatus, "DELIVERED");
  assert.equal(saved.at(-1).paymentStatus, "PAID");
  assert.equal(saved.at(-1).statusHistory.at(-1).note, "Delivered.");
  assert.ok(saved.at(-1).adminSeenAt, "changing an order marks it seen");
});

test("new-order feed and mark-all-seen never include unpaid online checkouts", async (t) => {
  const filters = [];
  t.mock.method(Order, "find", (filter) => {
    filters.push(filter);
    return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
  });
  t.mock.method(Order, "countDocuments", async (filter) => { filters.push(filter); return 0; });
  t.mock.method(Order, "updateMany", async (filter) => { filters.push(filter); return { modifiedCount: 0 }; });

  await adminOrders.feed();
  await adminOrders.markAllSeen();
  for (const filter of filters) {
    assert.deepEqual(filter.orderStatus, { $ne: "AWAITING_PAYMENT" });
    assert.deepEqual(filter["payment.expired"], { $ne: true });
    assert.equal(filter.adminSeenAt, null);
  }
});

// ------------------------------------------------------------------ products

/** No brand switched off, no category hidden (for product edits). */
function noHiddenBrandsOrCategories(t) {
  t.mock.method(Brand, "find", () => ({ lean: async () => [] }));
  t.mock.method(Category, "find", () => ({ lean: async () => [] }));
}

function fakeProduct(fields) {
  const product = {
    _id: "64b0000000000000000000b1", name: "Yoga Mat", slug: "yoga-mat", sellingPrice: 1000, mrp: 1500,
    discountPercent: 33, maxPrice: 1000, isActive: true, visibility: "published", hiddenBy: "",
    images: ["a.jpg", "b.jpg"], thumbnail: "a.jpg", variants: [], adminLocked: [], stockStatus: "in_stock",
    ...fields,
  };
  product.save = async () => product;
  return product;
}

test("product edit: price change recalculates discount and locks the fields for the rebuild", async (t) => {
  noHiddenBrandsOrCategories(t);
  const product = fakeProduct();
  t.mock.method(Product, "findById", (id) => {
    const result = Promise.resolve(product);
    result.lean = async () => ({ ...product });
    return result;
  });

  await adminProducts.update(product._id, { sellingPrice: 1200, isFeatured: true });
  assert.equal(product.sellingPrice, 1200);
  assert.equal(product.discountPercent, 20);
  assert.equal(product.maxPrice, 1200);
  assert.ok(product.adminLocked.includes("sellingPrice"));
  assert.ok(!product.adminLocked.includes("isFeatured"), "marketing flags are never overwritten anyway");

  await adminProducts.update(product._id, { live: false });
  assert.equal(product.isActive, false);
  assert.equal(product.visibility, "hidden");
  assert.ok(product.adminLocked.includes("isActive"));

  await adminProducts.update(product._id, { images: ["b.jpg", "a.jpg", "https://evil.example/x.jpg"] });
  assert.deepEqual(product.images, ["b.jpg", "a.jpg"], "only the product's own photos, in the new order");
  assert.equal(product.thumbnail, "b.jpg");

  await assert.rejects(adminProducts.update(product._id, { sellingPrice: "abc" }), /must be a number/);
});

test("product edit: option prices set the product's from-price and range", async (t) => {
  noHiddenBrandsOrCategories(t);
  const product = fakeProduct({
    variants: [
      { variantId: "v1", label: "5 kg", sellingPrice: 900, mrp: 1000, inStock: true },
      { variantId: "v2", label: "10 kg", sellingPrice: 1700, mrp: 2000, inStock: true },
    ],
  });
  t.mock.method(Product, "findById", () => {
    const result = Promise.resolve(product);
    result.lean = async () => ({ ...product });
    return result;
  });
  await adminProducts.update(product._id, { variants: [{ variantId: "v1", sellingPrice: 950, inStock: false }] });
  assert.equal(product.variants[0].sellingPrice, 950);
  assert.equal(product.variants[0].inStock, false);
  assert.equal(product.sellingPrice, 950);
  assert.equal(product.maxPrice, 1700);
  assert.ok(product.adminLocked.includes("variants"));
});

// ------------------------------------------------------------------ rebuild

test("catalogue rebuild keeps the admin's edits and hidden brands", () => {
  const fromMetro = () => ({ $set: { name: "Metro Name", sellingPrice: 999, mrp: 1200, isActive: true, visibility: "published", hiddenBy: "", brandSlug: "cosco" } });

  const locked = keepAdminChoices(fromMetro(), { name: "Our Name", sellingPrice: 850, mrp: 1200, adminLocked: ["name", "sellingPrice"] });
  assert.equal(locked.$set.name, "Our Name");
  assert.equal(locked.$set.sellingPrice, 850);
  assert.equal(locked.$set.mrp, 1200);

  const untouched = keepAdminChoices(fromMetro(), { name: "Old", sellingPrice: 1, adminLocked: [] });
  assert.equal(untouched.$set.name, "Metro Name");
  assert.equal(untouched.$set.sellingPrice, 999);

  const hiddenBrand = keepAdminChoices(fromMetro(), null, new Set(["cosco"]));
  assert.equal(hiddenBrand.$set.isActive, false);
  assert.equal(hiddenBrand.$set.visibility, "hidden");
  assert.equal(hiddenBrand.$set.hiddenBy, "admin-brand");
});

// ------------------------------------------------------------------ traffic

test("tracking helpers: device, referrer, path, India date", () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0)"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
  assert.equal(referrerHost("https://www.google.com/search?q=gym"), "google.com");
  assert.equal(referrerHost("https://shop.kreedum.com/cart"), "");
  assert.equal(referrerHost("not a url"), "");
  assert.equal(cleanPath("/checkout?phone=9876543210#x"), "/checkout");
  assert.equal(cleanPath("category/gym"), "/category/gym");
  assert.equal(indiaDay(new Date("2026-11-18T20:00:00Z")), "2026-11-19"); // 1:30 am in India
});

test("POST /api/v1/track saves a view, ignores bots and bad ids, always answers 204", async (t) => {
  const views = [];
  t.mock.method(PageView, "create", async (doc) => { views.push(doc); return doc; });

  const res = await request("POST", "/api/v1/track", { body: { visitorId: "visitor-12345678", path: "/brands?x=1", referrer: "https://instagram.com/" } });
  assert.equal(res.status, 204);
  assert.equal(views.length, 1);
  assert.equal(views[0].path, "/brands");
  assert.equal(views[0].referrer, "instagram.com");
  assert.equal(views[0].device, "mobile");

  assert.equal((await request("POST", "/api/v1/track", { body: { visitorId: "x", path: "/" } })).status, 204);
  assert.equal(await recordView({ visitorId: "visitor-12345678", path: "/" }, { userAgent: "Googlebot/2.1" }), false);
  assert.equal(views.length, 1);
});
