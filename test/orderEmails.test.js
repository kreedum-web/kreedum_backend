// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SITE_URL = "https://kreedum.example";

const { setTestTransport } = require("../src/utils/mailer");
const templates = require("../src/emails/templates");
const User = require("../src/models/User");

const users = [];
const asDoc = (row) => Object.assign(row, { async save() { return this; } });
User.findById = (id) => {
  const row = users.find((u) => u._id === id) || null;
  return { lean: async () => row, then: (res, rej) => Promise.resolve(row).then(res, rej) };
};
User.findOne = async () => null;

const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "m" }) });

const { sendOrderConfirmation, sendOrderCancelled } = require("../src/services/orderEmailService");
const { orderContactEmail } = require("../src/services/orderService");
const { fillProfileFromAddress } = require("../src/services/profileFillService");

const order = (extra = {}) => ({
  _id: "o1",
  orderNumber: "KRD-7",
  paymentMethod: "COD",
  paymentStatus: "PENDING",
  items: [{ name: "Football", variantLabel: "Size: 5", price: 799, quantity: 2, total: 1598 }],
  pricing: { subtotal: 1598, shippingCharge: 0, total: 1598 },
  shippingAddress: { fullName: "Ravi Kumar" },
  ...extra,
});

test("checkout email: account email wins; phone-only accounts must type one", async () => {
  users.length = 0;
  users.push({ _id: "e", email: "asha@gmail.com" }, { _id: "p", phone: "9876543210" });
  assert.equal(await orderContactEmail("e", "other@x.com"), "asha@gmail.com");
  assert.equal(await orderContactEmail("p", "  Ravi@Gmail.com "), "ravi@gmail.com");
  await assert.rejects(orderContactEmail("p", ""), /enter your email/);
  await assert.rejects(orderContactEmail("p", "ravi@"), /enter your email/);
});

test("a phone-only customer gets the order and cancellation emails at the address typed at checkout", async () => {
  users.length = 0;
  mailbox.length = 0;
  users.push({ _id: "p", phone: "9876543210", firstName: "" });
  assert.equal(await sendOrderConfirmation(order({ contactEmail: "ravi@gmail.com" }), "p"), true);
  assert.equal(await sendOrderCancelled(order({ contactEmail: "ravi@gmail.com", orderStatus: "CANCELLED" }), "p"), true);
  assert.deepEqual(mailbox.map((m) => [m.to, m.subject]), [
    ["ravi@gmail.com", "Order confirmed — KRD-7"],
    ["ravi@gmail.com", "Order cancelled — KRD-7"],
  ]);
  assert.match(mailbox[1].text, /^Hi Ravi,/); // name from the delivery address
});

test("older orders without a saved email use the account's; nobody to email → nothing sent", async () => {
  users.length = 0;
  mailbox.length = 0;
  users.push({ _id: "e", email: "asha@gmail.com", firstName: "Asha" }, { _id: "p", phone: "9876543210" });
  assert.equal(await sendOrderCancelled(order(), "e"), true);
  assert.equal(mailbox[0].to, "asha@gmail.com");
  assert.equal(await sendOrderCancelled(order(), "p"), false);
  assert.equal(mailbox.length, 1);
});

test("cancellation email: items, crossed-out total, nothing to pay for COD, refund line when paid", () => {
  const cod = templates.orderCancelledEmail({ order: order(), name: "Asha" });
  assert.equal(cod.subject, "Order cancelled — KRD-7");
  assert.match(cod.html, /Football/);
  assert.match(cod.html, /Size: 5/);
  assert.match(cod.html, /line-through[^>]*>₹1,598/);
  assert.match(cod.text, /nothing to pay/);
  assert.match(cod.html, /https:\/\/kreedum\.example\/account\/orders\/o1/);
  const paid = templates.orderCancelledEmail({ order: order({ paymentStatus: "PAID" }) });
  assert.match(paid.text, /refunded/);
});

test("the checkout email is remembered on phone-only accounts (never on email accounts)", async () => {
  users.length = 0;
  users.push(asDoc({ _id: "p", phone: "9876543210", firstName: "Ravi", contactEmail: "" }));
  users.push(asDoc({ _id: "e", email: "asha@gmail.com", firstName: "Asha", phone: "9000000001", contactEmail: "" }));
  assert.equal(await fillProfileFromAddress("p", { fullName: "Ravi" }, { contactEmail: "ravi@gmail.com" }), true);
  assert.equal(users[0].contactEmail, "ravi@gmail.com");
  assert.equal(await fillProfileFromAddress("e", { fullName: "Asha" }, { contactEmail: "asha@gmail.com" }), false);
  assert.equal(users[1].contactEmail, "");
});
