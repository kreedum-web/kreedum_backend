// Order steps in the admin: emails, couriers, messages. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const Order = require("../src/models/Order");
const User = require("../src/models/User");
const Courier = require("../src/models/Courier");
const adminOrders = require("../src/services/admin/adminOrderService");
const templates = require("../src/emails/templates");
const { setTestTransport } = require("../src/utils/mailer");

const mailbox = [];
setTestTransport({ sendMail: async (m) => (mailbox.push(m), { messageId: "m" }) });
const settle = () => new Promise((r) => setTimeout(r, 20)); // emails go out in the background

function setup(t, fields = {}) {
  const order = {
    _id: "64b0000000000000000000f2", orderNumber: "KRD-7", user: "64b0000000000000000000a1", contactEmail: "ravi@gmail.com",
    paymentMethod: "COD", paymentStatus: "PENDING", orderStatus: "PACKED", statusHistory: [], adminSeenAt: new Date(),
    pricing: { total: 16990 }, items: [{ name: "Spin Bike", quantity: 1 }], shippingAddress: { fullName: "Ravi" },
    customerEmails: [], shipment: {},
    ...fields,
  };
  order.save = async () => order;
  order.toObject = () => ({ ...order });
  t.mock.method(Order, "findById", () => {
    const result = Promise.resolve(order);
    result.populate = () => ({ lean: async () => ({ ...order }) });
    return result;
  });
  t.mock.method(User, "findById", () => ({ select: () => ({ lean: async () => ({ firstName: "Ravi", email: "ravi@gmail.com" }) }), lean: async () => ({ firstName: "Ravi", email: "ravi@gmail.com" }) }));
  mailbox.length = 0;
  return order;
}

test("shipped: courier, tracking number and its tracking link, in the order and the email", async (t) => {
  const order = setup(t);
  t.mock.method(Courier, "findOne", () => ({ lean: async () => ({ name: "Delhivery", trackingUrl: "https://track.example/{id}" }) }));
  const result = await adminOrders.updateStatus(order._id, { status: "SHIPPED", courier: "Delhivery", trackingId: "DL 123" });
  await settle();
  assert.equal(order.shipment.trackingUrl, "https://track.example/DL%20123");
  assert.equal(order.statusHistory.at(-1).note, "Shipped with Delhivery (tracking DL 123).");
  assert.equal(result.customerEmail, "ravi@gmail.com");
  assert.equal(mailbox.length, 1);
  assert.equal(mailbox[0].subject, "Order shipped — KRD-7");
  assert.match(mailbox[0].text, /Courier: Delhivery/);
  assert.match(mailbox[0].text, /Track it: https:\/\/track\.example\/DL%20123/);
});

test("every step emails the customer with the chosen message, unless switched off", async (t) => {
  const order = setup(t, { orderStatus: "SHIPPED" });
  await adminOrders.updateStatus(order._id, { status: "OUT_FOR_DELIVERY", note: "Our delivery partner will call before arriving." });
  await settle();
  assert.equal(mailbox[0].subject, "Out for delivery — KRD-7");
  assert.match(mailbox[0].text, /will call before arriving/);
  assert.equal(order.statusHistory.at(-1).note, "Our delivery partner will call before arriving.");

  await adminOrders.updateStatus(order._id, { status: "DELIVERED", notify: false });
  await settle();
  assert.equal(mailbox.length, 1, "no email when switched off");
});

test("a tracking link must be a web address", async (t) => {
  const order = setup(t);
  t.mock.method(Courier, "findOne", () => ({ lean: async () => null }));
  await assert.rejects(adminOrders.updateStatus(order._id, { status: "SHIPPED", trackingUrl: "javascript:alert(1)" }), /must start with http/);
});

test("email the customer from the admin: sent, and kept with the order", async (t) => {
  const order = setup(t);
  await adminOrders.emailCustomer(order._id, { subject: "Delivery time", message: "Hi! Is 5 pm okay?\n\nThanks" }, { firstName: "Asha" });
  assert.equal(mailbox[0].subject, "Delivery time");
  assert.match(mailbox[0].html, /Is 5 pm okay\?/);
  assert.equal(order.customerEmails[0].by, "Asha");
  await assert.rejects(adminOrders.emailCustomer(order._id, { message: "" }), /Write a message/);
});

test("step emails exist for every step after confirmed", () => {
  const order = { _id: "o", orderNumber: "KRD-1", pricing: { total: 1 }, items: [] };
  for (const status of ["PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"]) {
    assert.ok(templates.orderStepEmail({ order, status }).subject.endsWith("— KRD-1"), status);
  }
  assert.match(templates.orderConfirmedEmail({ order, message: "Delivery in 3 days." }).text, /Delivery in 3 days/);
});
