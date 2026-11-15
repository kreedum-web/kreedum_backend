// Run with: npm test
// Online payments with a stand-in for Cashfree's API (no real money, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.CASHFREE_APP_ID = "TEST_APP";
process.env.CASHFREE_SECRET_KEY = "test_secret_key";
process.env.CASHFREE_ENV = "sandbox";
process.env.SITE_URL = "https://shop.kreedum.com";
process.env.API_PUBLIC_URL = "https://api.kreedum.com";

const cashfree = require("../src/utils/cashfree");
const { setTestTransport } = require("../src/utils/mailer");

// ---------------------------------------------------------------- in-memory models

const Order = require("../src/models/Order");
const Cart = require("../src/models/Cart");
const User = require("../src/models/User");

const get = (obj, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
const set = (obj, path, value) => {
  const keys = path.split(".");
  let target = obj;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
};
function matches(row, query) {
  return Object.entries(query).every(([key, condition]) => {
    if (key === "$or") return condition.some((q) => matches(row, q));
    const value = get(row, key);
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      if ("$ne" in condition) return value !== condition.$ne;
      if ("$lt" in condition) return value < condition.$lt;
    }
    return String(value) === String(condition);
  });
}
function applyUpdate(row, update) {
  for (const [path, value] of Object.entries(update.$set || {})) set(row, path, value);
  for (const [path, value] of Object.entries(update.$push || {})) (get(row, path) || set(row, path, []) || get(row, path)).push(value);
}

const orders = [];
const asDoc = (row) =>
  Object.assign(row, {
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  });
Order.findOne = async (q) => orders.find((o) => matches(o, q)) || null;
Order.findById = async (id) => orders.find((o) => String(o._id) === String(id)) || null;
Order.findOneAndUpdate = async (q, update) => {
  const row = orders.find((o) => matches(o, q));
  if (!row) return null;
  applyUpdate(row, update);
  return row;
};
Order.updateOne = async (q, update) => {
  const row = orders.find((o) => matches(o, q));
  if (row) applyUpdate(row, update);
  return { modifiedCount: row ? 1 : 0 };
};
Order.updateMany = async (q, update) => {
  const rows = orders.filter((o) => matches(o, q));
  rows.forEach((row) => applyUpdate(row, update));
  return { modifiedCount: rows.length };
};
let cartCleared = [];
Cart.deleteMany = async (q) => cartCleared.push(String(q.user));
User.findById = (id) => ({ lean: async () => ({ _id: id, firstName: "Ravi", email: "ravi@gmail.com" }) });
User.findOne = async () => null;

const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "m" }) });

// ---------------------------------------------------------------- fake Cashfree

const realFetch = global.fetch;
let cf; // { calls, payments: {orderId: [...]}, refunds: [...], failCreate }
function fakeCashfree(t) {
  cf = { calls: [], payments: {}, refunds: [], failRefund: false };
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    cf.calls.push({ url: String(url), method: options.method, headers: options.headers, body });
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    assert.match(String(url), /^https:\/\/sandbox\.cashfree\.com\/pg\//);
    assert.equal(options.headers["x-client-id"], "TEST_APP");
    if (options.method === "POST" && String(url).endsWith("/orders")) {
      return ok({ order_id: body.order_id, cf_order_id: 9001, payment_session_id: `session_${body.order_id}`, order_status: "ACTIVE", order_expiry_time: body.order_expiry_time });
    }
    const paymentsMatch = String(url).match(/\/orders\/([^/]+)\/payments$/);
    if (paymentsMatch) return ok(cf.payments[decodeURIComponent(paymentsMatch[1])] || []);
    if (String(url).endsWith("/refunds")) {
      if (cf.failRefund) return { ok: false, status: 400, json: async () => ({ message: "refund amount greater than paid" }) };
      cf.refunds.push(body);
      return ok({ refund_id: body.refund_id, refund_status: "PENDING" });
    }
    throw new Error(`unexpected call ${url}`);
  };
  t.after(() => (global.fetch = realFetch));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
let seq = 0;
function onlineOrder(extra = {}) {
  seq++;
  const row = asDoc({
    _id: `64b0000000000000000000${String(seq).padStart(2, "0")}`,
    user: "64b000000000000000000001",
    orderNumber: `KRD-20261108-000${seq}`,
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING",
    orderStatus: "AWAITING_PAYMENT",
    createdAt: new Date(),
    contactEmail: "ravi@gmail.com",
    pricing: { subtotal: 2498, shippingCharge: 0, total: 2498 },
    items: [{ name: "Hex Dumbbell", quantity: 2, price: 1249, total: 2498 }],
    shippingAddress: { fullName: "Ravi Kumar", phone: "9876543210", email: "ravi@gmail.com" },
    statusHistory: [{ status: "AWAITING_PAYMENT" }],
    payment: {},
    ...extra,
  });
  orders.push(row);
  return row;
}
const reset = () => {
  orders.length = 0;
  mailbox.length = 0;
  cartCleared = [];
};

const payments = require("../src/services/paymentService");
const orderService = require("../src/services/orderService");

// ---------------------------------------------------------------- tests

test("webhook signature: same formula as Cashfree's SDK; anything else is refused", () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const ts = "1762578000000";
  const good = crypto.createHmac("sha256", "test_secret_key").update(ts + body).digest("base64");
  assert.equal(cashfree.verifyWebhook(body, ts, good), true);
  assert.equal(cashfree.verifyWebhook(body + " ", ts, good), false);
  assert.equal(cashfree.verifyWebhook(body, "1762578000001", good), false);
  assert.equal(cashfree.verifyWebhook(body, ts, "forged"), false);
  assert.equal(cashfree.verifyWebhook(body, ts, undefined), false);
});

test("starting a payment creates one Cashfree order with the right amount, customer and return address; reused on retry", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder();
  const started = await payments.startPayment(order.user, order._id);
  assert.equal(started.paymentSessionId, `session_${order.orderNumber}`);
  assert.equal(started.mode, "sandbox");

  const create = cf.calls[0];
  assert.equal(create.headers["x-api-version"], "2025-01-01");
  assert.equal(create.body.order_id, order.orderNumber);
  assert.equal(create.body.order_amount, 2498);
  assert.equal(create.body.order_currency, "INR");
  assert.deepEqual(create.body.customer_details, {
    customer_id: "64b000000000000000000001",
    customer_phone: "9876543210",
    customer_email: "ravi@gmail.com",
    customer_name: "Ravi Kumar",
  });
  assert.equal(create.body.order_meta.return_url, `https://shop.kreedum.com/payment/return?order=${order._id}`);
  assert.equal(create.body.order_meta.notify_url, "https://api.kreedum.com/api/v1/payments/cashfree/webhook");

  await payments.startPayment(order.user, order._id); // e.g. customer came back and pressed Pay again
  assert.equal(cf.calls.length, 1);
});

test("only the customer's own unpaid online orders can be paid", async (t) => {
  fakeCashfree(t);
  reset();
  const cod = onlineOrder({ paymentMethod: "COD", orderStatus: "PENDING" });
  const paid = onlineOrder({ paymentStatus: "PAID", orderStatus: "PENDING" });
  const code = (p) => p.then(() => "ok", (e) => e.code);
  assert.equal(await code(payments.startPayment(cod.user, cod._id)), "NOT_ONLINE");
  assert.equal(await code(payments.startPayment(paid.user, paid._id)), "ALREADY_PAID");
  assert.equal(await code(payments.startPayment("64b000000000000000000099", cod._id)), "ORDER_NOT_FOUND");
});

test("successful payment: order paid once, cart emptied, one confirmation email, even when checked twice at once", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder();
  await payments.startPayment(order.user, order._id);
  cf.payments[order.orderNumber] = [{ cf_payment_id: 555, payment_status: "SUCCESS", payment_amount: 2498, payment_group: "upi" }];

  const [a, b] = await Promise.all([payments.paymentStatus(order.user, order._id), payments.paymentStatus(order.user, order._id)]);
  await flush();
  assert.equal(a.paymentStatus, "PAID");
  assert.equal(b.paymentStatus, "PAID");
  assert.equal(order.orderStatus, "PENDING");
  assert.equal(order.payment.paymentId, "555");
  assert.equal(order.payment.method, "upi");
  assert.deepEqual(cartCleared, [order.user]);
  assert.equal(mailbox.filter((m) => /Order confirmed/.test(m.subject)).length, 1);
  assert.match(mailbox[0].text, /Paid online \(upi\)/);
});

test("a payment for the wrong amount doesn't count; a failed one is shown to the customer", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder();
  await payments.startPayment(order.user, order._id);
  cf.payments[order.orderNumber] = [
    { payment_status: "SUCCESS", payment_amount: 1, payment_time: "2026-11-08T10:00:00+05:30" },
    { payment_status: "FAILED", payment_amount: 2498, payment_message: "Insufficient balance", payment_time: "2026-11-08T10:05:00+05:30" },
  ];
  const status = await payments.paymentStatus(order.user, order._id);
  assert.equal(status.paymentStatus, "PENDING");
  assert.equal(status.orderStatus, "AWAITING_PAYMENT");
  assert.equal(status.lastFailure, "Insufficient balance");
  assert.equal(cartCleared.length, 0);
});

test("webhook: signed message confirms the payment (checked with Cashfree); unsigned is refused", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder();
  await payments.startPayment(order.user, order._id);
  cf.payments[order.orderNumber] = [{ cf_payment_id: 7, payment_status: "SUCCESS", payment_amount: 2498 }];
  const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: order.orderNumber }, payment: { payment_status: "SUCCESS" } } });
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", "test_secret_key").update(ts + body).digest("base64");

  assert.equal(await payments.handleWebhook(body, { "x-webhook-timestamp": ts, "x-webhook-signature": "nope" }), false);
  assert.equal(order.paymentStatus, "PENDING");
  assert.equal(await payments.handleWebhook(body, { "x-webhook-timestamp": ts, "x-webhook-signature": sig }), true);
  assert.equal(order.paymentStatus, "PAID");
});

test("not paid within an hour → cancelled; a payment that still arrives later revives it", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder({ createdAt: new Date(Date.now() - 61 * 60 * 1000), payment: { gateway: "cashfree", gatewayOrderId: "KRD-OLD" } });
  const fresh = onlineOrder();
  assert.equal(await payments.expireUnpaidOrders(), 1);
  assert.equal(order.orderStatus, "CANCELLED");
  assert.equal(order.payment.expired, true);
  assert.equal(fresh.orderStatus, "AWAITING_PAYMENT");
  await assert.rejects(payments.startPayment(order.user, order._id), (e) => e.code === "PAYMENT_CLOSED");

  cf.payments["KRD-OLD"] = [{ cf_payment_id: 9, payment_status: "SUCCESS", payment_amount: 2498 }];
  await payments.confirmPayment(order);
  assert.equal(order.paymentStatus, "PAID");
  assert.equal(order.orderStatus, "PENDING");
});

test("cancelling a paid online order refunds it in full through Cashfree; refund webhook completes it", async (t) => {
  fakeCashfree(t);
  reset();
  const order = onlineOrder({ paymentStatus: "PAID", orderStatus: "PENDING", payment: { gateway: "cashfree", gatewayOrderId: "KRD-PAID", paymentId: "1" } });
  await orderService.cancelOrder(order.user, order._id);
  await flush();
  assert.equal(order.orderStatus, "CANCELLED");
  assert.deepEqual(cf.refunds, [{ refund_id: `${order.orderNumber}-refund`, refund_amount: 2498, refund_note: "Order cancelled" }]);
  assert.equal(order.paymentStatus, "REFUND_INITIATED");
  const email = mailbox.find((m) => /Order cancelled/.test(m.subject));
  assert.match(email.text, /being refunded/);

  const body = JSON.stringify({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { order_id: "KRD-PAID", refund_status: "SUCCESS" } } });
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", "test_secret_key").update(ts + body).digest("base64");
  await payments.handleWebhook(body, { "x-webhook-timestamp": ts, "x-webhook-signature": sig });
  assert.equal(order.paymentStatus, "REFUNDED");
});

test("if Cashfree refuses the refund, the order is still cancelled and marked for a manual refund", async (t) => {
  fakeCashfree(t);
  reset();
  cf.failRefund = true;
  const order = onlineOrder({ paymentStatus: "PAID", orderStatus: "PENDING", payment: { gatewayOrderId: "KRD-X" } });
  const error = console.error;
  console.error = () => {};
  try {
    await payments.refundOrder(order);
  } finally {
    console.error = error;
  }
  assert.equal(order.paymentStatus, "PAID");
  assert.equal(order.payment.refundStatus, "NOT_STARTED");
});

test("without Cashfree keys online payment is off", (t) => {
  const saved = process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_APP_ID;
  t.after(() => (process.env.CASHFREE_APP_ID = saved));
  assert.deepEqual(payments.options(), { online: false, mode: null, payWithinMinutes: 60 });
});
