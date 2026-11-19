// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const Notification = require("../src/models/Notification");
const Enquiry = require("../src/models/Enquiry");
const Product = require("../src/models/Product");
const User = require("../src/models/User");
const notificationService = require("../src/services/notificationService");
const enquiryService = require("../src/services/enquiryService");
const { linePrice } = require("../src/services/admin/adminCartService");
const app = require("../src/app");

const settle = () => new Promise((r) => setTimeout(r, 20));

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = JSON.stringify(body);
      const req = http.request(
        { port: server.address().port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...(token ? { authorization: `Bearer ${token}` } : {}) } },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
        }
      );
      req.on("error", (e) => { server.close(); reject(e); });
      req.end(data);
    });
  });
}

// ------------------------------------------------------------ notifications

test("notifications are kept for 2 days (TTL index)", () => {
  const ttl = Notification.schema.indexes().find(([fields, opts]) => fields.createdAt === 1 && opts.expireAfterSeconds);
  assert.ok(ttl, "TTL index exists");
  assert.equal(ttl[1].expireAfterSeconds, 2 * 24 * 60 * 60);
});

test("only the newest 20 notifications are kept", async (t) => {
  const deleted = [];
  t.mock.method(Notification, "create", async (doc) => doc);
  t.mock.method(Notification, "find", () => ({
    sort: () => ({ limit: (n) => ({ lean: async () => Array.from({ length: n }, (_, i) => ({ _id: `id${i}` })) }) }),
  }));
  t.mock.method(Notification, "deleteMany", async (filter) => { deleted.push(filter); return {}; });

  await notificationService.notify({ type: "NEW_ORDER", title: "x" });
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0]._id.$nin.length, 20);
});

test("a failing notification never throws into an order or enquiry", async (t) => {
  t.mock.method(Notification, "create", async () => { throw new Error("db down"); });
  t.mock.method(console, "error", () => {});
  await assert.doesNotReject(notificationService.notify({ type: "NEW_ORDER", title: "x" }));
});

test("alert texts for orders and each enquiry kind", async (t) => {
  const saved = [];
  t.mock.method(Notification, "create", async (doc) => { saved.push(doc); return doc; });
  t.mock.method(Notification, "find", () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));

  await notificationService.newOrder({ _id: "o1", orderNumber: "KRD-1", paymentMethod: "COD", pricing: { total: 1499 }, items: [{ quantity: 2 }], shippingAddress: { fullName: "Asha", city: "Lucknow" } });
  await notificationService.orderCancelledByCustomer({ _id: "o1", orderNumber: "KRD-1", paymentMethod: "ONLINE", paymentStatus: "REFUND_INITIATED", pricing: { total: 1499 }, shippingAddress: { fullName: "Asha" } });
  await notificationService.newEnquiry({ kind: "product", name: "", accountLogin: "", productName: "Yoga Mat" });
  await notificationService.newEnquiry({ kind: "contact", name: "Ravi", city: "", topic: "Order support", message: "Where is my order?" });

  assert.equal(saved[0].type, "NEW_ORDER");
  assert.match(saved[0].body, /Asha, Lucknow · 2 items · ₹1,499 · Cash on delivery/);
  assert.equal(saved[0].link, "/orders/o1");
  assert.equal(saved[1].type, "ORDER_CANCELLED");
  assert.match(saved[1].body, /refund started/);
  assert.equal(saved[2].type, "PRODUCT_ENQUIRY");
  assert.match(saved[2].title, /A website visitor asked about a product/);
  assert.equal(saved[2].body, "Yoga Mat");
  assert.equal(saved[3].type, "CONTACT_ENQUIRY");
  assert.equal(saved[3].link, "/enquiries?kind=contact");
});

// ------------------------------------------------------------ enquiries

test("WhatsApp click: product page → product enquiry with alert; repeat within 30 min only counts", async (t) => {
  const created = [];
  const alerts = [];
  let recent = null;
  t.mock.method(Product, "findOne", () => ({ lean: async () => ({ _id: "p1", name: "Yoga Mat", slug: "yoga-mat", sku: "YM1" }) }));
  t.mock.method(Enquiry, "findOneAndUpdate", async () => recent);
  t.mock.method(Enquiry, "create", async (doc) => { created.push(doc); return doc; });
  t.mock.method(notificationService, "newEnquiry", (e) => alerts.push(e));

  const first = await enquiryService.logWhatsappClick({ visitorId: "visitor-12345678", source: "product-page", productSlug: "yoga-mat", quantity: 2 });
  assert.deepEqual(first, { saved: true, repeat: false });
  assert.equal(created[0].kind, "product");
  assert.equal(created[0].productName, "Yoga Mat");
  assert.equal(created[0].quantity, 2);
  assert.equal(alerts.length, 1);

  recent = { _id: "e1" };
  const again = await enquiryService.logWhatsappClick({ visitorId: "visitor-12345678", source: "product-page", productSlug: "yoga-mat" });
  assert.deepEqual(again, { saved: true, repeat: true });
  assert.equal(created.length, 1);
  assert.equal(alerts.length, 1);
});

test("WhatsApp click: signed-in customer's name and phone are filled in; guests need a visitor id", async (t) => {
  const created = [];
  t.mock.method(Product, "findOne", () => ({ lean: async () => null }));
  t.mock.method(Enquiry, "findOneAndUpdate", async () => null);
  t.mock.method(Enquiry, "create", async (doc) => { created.push(doc); return doc; });
  t.mock.method(notificationService, "newEnquiry", () => {});

  assert.deepEqual(await enquiryService.logWhatsappClick({ source: "floating" }), { saved: false });
  await enquiryService.logWhatsappClick({ source: "floating", page: "/cart" }, { user: { _id: "u1", firstName: "Ravi", lastName: "Kumar", phone: "9876543210" } });
  assert.equal(created[0].kind, "whatsapp");
  assert.equal(created[0].name, "Ravi Kumar");
  assert.equal(created[0].phone, "9876543210");
  assert.equal(created[0].signedIn, true);
});

test("contact form: checks name, phone and message, then saves and alerts", async (t) => {
  const created = [];
  const alerts = [];
  t.mock.method(Enquiry, "create", async (doc) => { created.push(doc); return { ...doc, _id: "c1" }; });
  t.mock.method(notificationService, "newEnquiry", (e) => alerts.push(e));

  await assert.rejects(enquiryService.submitContact({ name: "R", phone: "9876543210", message: "hi" }), /your name/);
  await assert.rejects(enquiryService.submitContact({ name: "Ravi", phone: "12345", message: "hi" }), /10-digit/);
  await assert.rejects(enquiryService.submitContact({ name: "Ravi", phone: "9876543210", message: "" }), /message/);

  await enquiryService.submitContact({ name: "Ravi", phone: "+91 98765 43210", topic: "Order support", message: "Where is my order?" });
  assert.equal(created[0].kind, "contact");
  assert.equal(created[0].phone, "9876543210");
  assert.equal(alerts.length, 1);
});

test("POST /api/v1/enquiries/whatsapp always answers 204", async (t) => {
  t.mock.method(Product, "findOne", () => ({ lean: async () => null }));
  t.mock.method(Enquiry, "findOneAndUpdate", async () => null);
  t.mock.method(Enquiry, "create", async (doc) => doc);
  t.mock.method(notificationService, "newEnquiry", () => {});
  assert.equal((await post("/api/v1/enquiries/whatsapp", { visitorId: "visitor-12345678", source: "floating" })).status, 204);
  assert.equal((await post("/api/v1/enquiries/whatsapp", {})).status, 204);
});

test("admin notifications and carts need an admin", async (t) => {
  t.mock.method(User, "findById", async () => ({ _id: "c1", role: "customer", isActive: true }));
  const token = jwt.sign({ id: "64b0000000000000000000c1" }, process.env.JWT_SECRET);
  assert.equal((await post("/api/v1/admin/notifications/read", {}, token)).status, 403);
  assert.equal((await post("/api/v1/admin/carts/64b0000000000000000000c1/follow-ups", { note: "x" }, token)).status, 403);
  await settle();
});

// ------------------------------------------------------------ carts

test("cart line price uses the chosen option's price", () => {
  const product = { sellingPrice: 900, stockStatus: "in_stock", variants: [{ variantId: "v10", label: "10 kg", sellingPrice: 1700, inStock: false }] };
  assert.deepEqual(linePrice(product, "v10"), { price: 1700, label: "10 kg", inStock: false });
  assert.deepEqual(linePrice(product, ""), { price: 900, label: "", inStock: true });
  assert.deepEqual(linePrice(product, "gone"), { price: 900, label: "", inStock: true });
});
