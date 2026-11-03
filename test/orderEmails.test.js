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

test("order email: the delivery address's email first, else the account's; phone accounts need one on the address", async () => {
  users.length = 0;
  users.push({ _id: "e", email: "asha@gmail.com" }, { _id: "p", phone: "9876543210", phoneVerified: true });
  assert.equal(await orderContactEmail("e", { email: "Office@Asha.in " }), "office@asha.in");
  assert.equal(await orderContactEmail("e", { email: "" }), "asha@gmail.com");
  assert.equal(await orderContactEmail("p", { email: "ravi@gmail.com" }), "ravi@gmail.com");
  assert.equal(await orderContactEmail("p", {}, "typed@gmail.com"), "typed@gmail.com"); // older website versions
  await assert.rejects(orderContactEmail("p", { email: "" }), /add an email address to the delivery address/);
  await assert.rejects(orderContactEmail("p", { email: "ravi@" }), /add an email address/);
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

test("a skipped name is taken from the first delivery address; phone and email on it never touch the account", async () => {
  users.length = 0;
  users.push(asDoc({ _id: "p", phone: "9876543210", phoneVerified: true, firstName: "", lastName: "" }));
  users.push(asDoc({ _id: "e", email: "asha@gmail.com", firstName: "Asha", phone: "" }));
  assert.equal(await fillProfileFromAddress("p", { fullName: "Ravi  Kumar Singh", phone: "9123456789", email: "x@y.com" }), true);
  assert.deepEqual([users[0].firstName, users[0].lastName, users[0].phone, users[0].email], ["Ravi", "Kumar Singh", "9876543210", undefined]);
  assert.equal(await fillProfileFromAddress("e", { fullName: "Someone Else", phone: "9123456789" }), false);
  assert.deepEqual([users[1].firstName, users[1].phone], ["Asha", ""]);
});
