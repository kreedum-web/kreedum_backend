// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
process.env.SITE_URL = "https://kreedum.example";

const { smtpSettings, sendMail, setTestTransport } = require("../src/utils/mailer");
const templates = require("../src/emails/templates");

// ---------------------------------------------------------------- in-memory models

const EmailCode = require("../src/models/EmailCode");
const User = require("../src/models/User");

const codes = [];
EmailCode.findOne = async (q) => codes.find((c) => c.email === q.email && c.purpose === q.purpose) || null;
EmailCode.updateOne = async (q, update, options = {}) => {
  let row = codes.find((c) => c.email === q.email && c.purpose === q.purpose);
  if (!row && options.upsert) codes.push((row = {}));
  if (row) Object.assign(row, update.$set);
};

const users = [];
const asDoc = (row) =>
  Object.assign(row, {
    async save() {
      return this;
    },
  });
const query = (row) => ({ select: async () => row, then: (res, rej) => Promise.resolve(row).then(res, rej) });
User.findOne = (q) => query(users.find((u) => u.email === q.email) || null);
User.create = async (data) => {
  const row = asDoc({ _id: `u${users.length + 1}`, role: "customer", isActive: true, ...data });
  users.push(row);
  return row;
};
User.findById = (id) => ({ lean: async () => users.find((u) => u._id === id) || null });

// Captured mailbox
const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: `m${mailbox.length}` }) });
const lastCode = () => mailbox.at(-1).text.match(/\b(\d{6})\b/)[1];

const reset = () => {
  codes.length = 0;
  users.length = 0;
  mailbox.length = 0;
};

// ---------------------------------------------------------------- mailer & templates

test("Gmail by default; spaces in the App Password are ignored; any SMTP via .env", () => {
  assert.equal(smtpSettings({}), null);
  assert.deepEqual(smtpSettings({ SMTP_USER: "kreedum@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" }), {
    service: "gmail",
    auth: { user: "kreedum@gmail.com", pass: "abcdefghijklmnop" },
  });
  assert.deepEqual(smtpSettings({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "465", SMTP_USER: "u", SMTP_PASS: "p" }), {
    host: "smtp-relay.brevo.com",
    port: 465,
    secure: true,
    auth: { user: "u", pass: "p" },
  });
});

test("without SMTP settings the email is printed instead of sent", async () => {
  setTestTransport(null);
  const original = console.log;
  let printed = "";
  console.log = (text) => (printed += text);
  try {
    const result = await sendMail({ to: "a@b.c", subject: "Hi", html: "<p>x</p>", text: "Your code is 123456" });
    assert.deepEqual(result, { sent: false, via: "log" });
    assert.match(printed, /NOT sent[\s\S]*Your code is 123456/);
  } finally {
    console.log = original;
    setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "x" }) });
  }
});

test("emails escape customer text and show the code / order details", () => {
  const verify = templates.verificationCodeEmail({ name: "<Asha>", code: "012345" });
  assert.match(verify.subject, /^012345 is your Kreedum Sports verification code$/);
  assert.match(verify.html, /&lt;Asha&gt;/);
  assert.doesNotMatch(verify.html, /<Asha>/);

  const order = {
    _id: "o1",
    orderNumber: "KRD-20261101-0001",
    paymentMethod: "COD",
    items: [{ name: "Hex Dumbbells", variantLabel: "Weight: 5 kg x 1 Pair", price: 2249, quantity: 2, total: 4498 }],
    pricing: { subtotal: 4498, shippingCharge: 0, discount: 0, total: 4498 },
    shippingAddress: { fullName: "Asha", addressLine1: "12 MG Road", city: "Lucknow", state: "UP", pincode: "226001" },
  };
  const confirmation = templates.orderConfirmationEmail({ order, name: "Asha" });
  assert.equal(confirmation.subject, "Order confirmed — KRD-20261101-0001");
  assert.match(confirmation.html, /Weight: 5 kg x 1 Pair/);
  assert.match(confirmation.html, /₹4,498/);
  assert.match(confirmation.html, /https:\/\/kreedum\.example\/account\/orders\/o1/);
  assert.match(confirmation.text, /Shipping: Free/);
});

// ---------------------------------------------------------------- codes

test("codes: 6 digits, wrong tries counted, locked after 5, used once, expire", async () => {
  reset();
  const service = require("../src/services/emailCodeService");
  const code = await service.issue("A@B.com", "verify_email");
  assert.match(code, /^\d{6}$/);
  assert.notEqual(codes[0].codeHash, code); // only a hash is stored

  const wrong = code === "000000" ? "111111" : "000000";
  await assert.rejects(service.verify("a@b.com", "verify_email", wrong), /Wrong code\. 4 tries left/);
  assert.equal(await service.verify("a@b.com", "verify_email", code), true);
  await assert.rejects(service.verify("a@b.com", "verify_email", code), /expired/); // used up

  const later = new Date(Date.now() + 61 * 1000);
  const second = await service.issue("a@b.com", "verify_email", later);
  for (let i = 0; i < 5; i++) await service.verify("a@b.com", "verify_email", wrong, later).catch(() => {});
  await assert.rejects(service.verify("a@b.com", "verify_email", second, later), /Too many wrong codes/);

  const third = await service.issue("a@b.com", "verify_email", new Date(later.getTime() + 61 * 1000));
  await assert.rejects(
    service.verify("a@b.com", "verify_email", third, new Date(later.getTime() + 12 * 60 * 1000)),
    /expired/
  );
});

test("codes: one a minute, five an hour", async () => {
  reset();
  const service = require("../src/services/emailCodeService");
  const start = new Date("2026-11-01T10:00:00Z");
  await service.issue("x@y.z", "reset_password", start);
  await assert.rejects(service.issue("x@y.z", "reset_password", new Date(start.getTime() + 20 * 1000)), /wait 40 seconds/);
  for (let i = 1; i <= 4; i++) await service.issue("x@y.z", "reset_password", new Date(start.getTime() + i * 61 * 1000));
  await assert.rejects(service.issue("x@y.z", "reset_password", new Date(start.getTime() + 6 * 61 * 1000)), /in an hour/);
  await service.issue("x@y.z", "reset_password", new Date(start.getTime() + 3601 * 1000)); // new hour
});

// ---------------------------------------------------------------- sign-up & login

const auth = require("../src/services/authService");
const signUp = (extra = {}) =>
  auth.register({ firstName: "Asha", email: "Asha@Gmail.com", password: "secret123", ...extra });

test("sign-up emails a code instead of logging in; the code finishes sign-up and logs in", async () => {
  reset();
  const result = await signUp();
  assert.deepEqual(result, { requiresVerification: true, email: "asha@gmail.com" });
  assert.equal(users[0].emailVerified, false);
  assert.equal(mailbox[0].to, "asha@gmail.com");
  assert.match(mailbox[0].subject, /verification code/);

  const done = await auth.verifyEmail("asha@gmail.com", lastCode());
  assert.ok(done.token);
  assert.equal(done.user.email, "asha@gmail.com");
  assert.equal(users[0].emailVerified, true);

  await assert.rejects(signUp(), /Email already registered/);
});

test("login before entering the code: refused with EMAIL_NOT_VERIFIED; after verifying it works", async () => {
  reset();
  await signUp();
  await assert.rejects(auth.login("asha@gmail.com", "secret123"), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "EMAIL_NOT_VERIFIED");
    assert.equal(error.extra.email, "asha@gmail.com");
    return true;
  });
  await auth.verifyEmail("asha@gmail.com", lastCode());
  const login = await auth.login("asha@gmail.com", "secret123");
  assert.ok(login.token);
});

test("accounts created before email codes keep logging in normally", async () => {
  reset();
  const bcrypt = require("bcryptjs");
  users.push(asDoc({ _id: "old", firstName: "Old", email: "old@x.com", password: await bcrypt.hash("password1", 4), role: "customer" }));
  const login = await auth.login("old@x.com", "password1");
  assert.ok(login.token);
  assert.equal(mailbox.length, 0);
});

test("signing up again before verifying replaces the details and sends a new code", async () => {
  reset();
  await signUp();
  codes[0].lastSentAt = new Date(Date.now() - 2 * 60 * 1000); // a while ago
  await signUp({ firstName: "Asha R", password: "another123" });
  assert.equal(users.length, 1);
  assert.equal(users[0].firstName, "Asha R");
  assert.equal(mailbox.length, 2);
});

test("forgot password: same answer for unknown emails; the code sets a new password and logs in", async () => {
  reset();
  assert.deepEqual(await auth.forgotPassword("nobody@x.com"), { sent: true });
  assert.equal(mailbox.length, 0);

  await signUp();
  await auth.verifyEmail("asha@gmail.com", lastCode());
  await auth.forgotPassword("asha@gmail.com");
  assert.match(mailbox.at(-1).subject, /password reset code/);

  await assert.rejects(auth.resetPassword("asha@gmail.com", lastCode(), "short"), /at least 8/);
  const done = await auth.resetPassword("asha@gmail.com", lastCode(), "brandnew123");
  assert.ok(done.token);
  assert.ok(await auth.login("asha@gmail.com", "brandnew123"));
  await assert.rejects(auth.login("asha@gmail.com", "secret123"), /Invalid email or password/);
});

// ---------------------------------------------------------------- order email

test("order confirmation goes to the customer; a mail failure never throws", async () => {
  reset();
  users.push(asDoc({ _id: "u9", firstName: "Asha", email: "asha@gmail.com" }));
  const { sendOrderConfirmation } = require("../src/services/orderEmailService");
  const order = { _id: "o1", orderNumber: "KRD-1", items: [], pricing: { total: 0 }, shippingAddress: {} };

  assert.equal(await sendOrderConfirmation(order, "u9"), true);
  assert.equal(mailbox[0].to, "asha@gmail.com");
  assert.equal(mailbox[0].subject, "Order confirmed — KRD-1");

  setTestTransport({ sendMail: async () => { throw new Error("SMTP down"); } });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await sendOrderConfirmation(order, "u9"), false);
  } finally {
    console.error = original;
    setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "x" }) });
  }
});
