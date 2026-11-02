// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.GOOGLE_CLIENT_ID = "kreedum-web.apps.googleusercontent.com";

const { setTestTransport } = require("../src/utils/mailer");

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
const matches = (row, q) =>
  Object.entries(q).every(([key, value]) =>
    value && typeof value === "object" && "$ne" in value ? row[key] !== value.$ne : row[key] === value
  );
const query = (row) => ({ select: async () => row, then: (res, rej) => Promise.resolve(row).then(res, rej) });
User.findOne = (q) => query(users.find((u) => matches(u, q)) || null);
User.findById = async (id) => users.find((u) => u._id === id) || null;
User.create = async (data) => {
  const row = asDoc({ _id: `u${users.length + 1}`, firstName: "", lastName: "", phone: "", role: "customer", isActive: true, ...data });
  users.push(row);
  return row;
};

const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: `m${mailbox.length}` }) });
const lastCode = () => mailbox.at(-1).text.match(/\b(\d{6})\b/)[1];

const reset = () => {
  codes.length = 0;
  users.length = 0;
  mailbox.length = 0;
};

const auth = require("../src/services/authService");

// ---------------------------------------------------------------- email code

test("email code: a new email gets a code, and the code creates the account and signs in", async () => {
  reset();
  assert.deepEqual(await auth.startEmailLogin("  Asha@Gmail.com "), { sent: true, email: "asha@gmail.com" });
  assert.equal(mailbox[0].to, "asha@gmail.com");
  assert.match(mailbox[0].subject, /sign-in code/);
  assert.equal(users.length, 0); // nothing created until the code is right

  await assert.rejects(auth.verifyEmailLogin("asha@gmail.com", lastCode() === "000000" ? "111111" : "000000"), /Wrong code/);

  const result = await auth.verifyEmailLogin("asha@gmail.com", lastCode());
  assert.equal(result.isNew, true);
  assert.ok(result.token);
  assert.equal(result.user.email, "asha@gmail.com");
  assert.equal(result.user.firstName, "");
  assert.equal(users.length, 1);
  assert.equal(users[0].emailVerified, true);
  assert.equal(users[0].password, undefined);
});

test("email code: an existing account signs in (no duplicate) and an unfinished sign-up is finished", async () => {
  reset();
  users.push(asDoc({ _id: "old", firstName: "Ravi", email: "ravi@x.com", emailVerified: false, isActive: true, role: "customer" }));
  await auth.startEmailLogin("ravi@x.com");
  assert.match(mailbox[0].text, /Hi Ravi/);
  const result = await auth.verifyEmailLogin("ravi@x.com", lastCode());
  assert.equal(result.isNew, false);
  assert.equal(users.length, 1);
  assert.equal(users[0].emailVerified, true);
});

test("email code: bad email refused; disabled accounts can't sign in", async () => {
  reset();
  await assert.rejects(auth.startEmailLogin("not-an-email"), /valid email/);
  users.push(asDoc({ _id: "off", email: "off@x.com", isActive: false }));
  await assert.rejects(auth.startEmailLogin("off@x.com"), /disabled/);
  assert.equal(mailbox.length, 0);
});

test("password login on an account without a password says to use a code", async () => {
  reset();
  users.push(asDoc({ _id: "c1", email: "code@x.com", isActive: true }));
  await assert.rejects(auth.login("code@x.com", "whatever1"), (error) => {
    assert.equal(error.code, "NO_PASSWORD");
    return true;
  });
});

// ---------------------------------------------------------------- Google

const realFetch = global.fetch;
function fakeGoogle(info, ok = true) {
  global.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);
    return { ok, json: async () => info };
  };
}
const googleInfo = (extra = {}) => ({
  aud: process.env.GOOGLE_CLIENT_ID,
  iss: "https://accounts.google.com",
  exp: String(Math.floor(Date.now() / 1000) + 3600),
  sub: "g-123",
  email: "Meera@Gmail.com",
  email_verified: "true",
  given_name: "Meera",
  family_name: "Singh",
  picture: "https://lh3.googleusercontent.com/a/x",
  ...extra,
});

test("Google: new customer gets an account with their name; second time signs in to the same one", async (t) => {
  t.after(() => (global.fetch = realFetch));
  reset();
  fakeGoogle(googleInfo());
  const first = await auth.googleLogin("id-token");
  assert.equal(first.isNew, true);
  assert.equal(first.user.email, "meera@gmail.com");
  assert.equal(first.user.firstName, "Meera");
  assert.equal(first.user.avatarUrl, "https://lh3.googleusercontent.com/a/x");
  assert.equal(users[0].googleId, "g-123");

  const second = await auth.googleLogin("id-token");
  assert.equal(second.isNew, false);
  assert.equal(users.length, 1);
});

test("Google: an existing email account is linked, keeping its own name", async (t) => {
  t.after(() => (global.fetch = realFetch));
  reset();
  users.push(asDoc({ _id: "e1", firstName: "Mee", email: "meera@gmail.com", isActive: true, role: "customer" }));
  fakeGoogle(googleInfo());
  const result = await auth.googleLogin("id-token");
  assert.equal(result.isNew, false);
  assert.equal(users.length, 1);
  assert.equal(users[0].googleId, "g-123");
  assert.equal(users[0].firstName, "Mee");
  assert.equal(users[0].lastName, "Singh");
});

test("Google: tokens for another app, expired, or with an unverified email are refused", async (t) => {
  t.after(() => (global.fetch = realFetch));
  reset();
  for (const bad of [
    googleInfo({ aud: "someone-else.apps.googleusercontent.com" }),
    googleInfo({ exp: String(Math.floor(Date.now() / 1000) - 10) }),
    googleInfo({ iss: "evil.example" }),
  ]) {
    fakeGoogle(bad);
    await assert.rejects(auth.googleLogin("id-token"), /Google sign-in failed/);
  }
  fakeGoogle({ error: "invalid_token" }, false);
  await assert.rejects(auth.googleLogin("id-token"), /Google sign-in failed/);
  fakeGoogle(googleInfo({ email_verified: "false" }));
  await assert.rejects(auth.googleLogin("id-token"), /isn't verified/);
  assert.equal(users.length, 0);
});

test("Google: not set up → clear message, Google isn't called", async (t) => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  t.after(() => {
    process.env.GOOGLE_CLIENT_ID = saved;
    global.fetch = realFetch;
  });
  delete process.env.GOOGLE_CLIENT_ID;
  global.fetch = async () => assert.fail("should not call Google");
  await assert.rejects(auth.googleLogin("id-token"), (error) => error.code === "GOOGLE_NOT_CONFIGURED");
});

// ---------------------------------------------------------------- name from checkout

test("first checkout address gives a new account its name and phone; existing ones are kept", async () => {
  reset();
  const { fillProfileFromAddress } = require("../src/services/profileFillService");
  users.push(asDoc({ _id: "n1", email: "n@x.com", firstName: "", lastName: "", phone: "" }));
  users.push(asDoc({ _id: "n2", email: "k@x.com", firstName: "Kiran", lastName: "", phone: "9000000001" }));

  assert.equal(await fillProfileFromAddress("n1", { fullName: "Asha  Rani Verma", phone: "+91 98765 43210" }), true);
  assert.equal(users[0].firstName, "Asha");
  assert.equal(users[0].lastName, "Rani Verma");
  assert.equal(users[0].phone, "9876543210");

  assert.equal(await fillProfileFromAddress("n2", { fullName: "Someone Else", phone: "9123456789" }), false);
  assert.equal(users[1].firstName, "Kiran");
  assert.equal(users[1].phone, "9000000001");

  // phone already used by another account: name still filled, phone skipped
  users.push(asDoc({ _id: "n3", email: "z@x.com", firstName: "", phone: "" }));
  await fillProfileFromAddress("n3", { fullName: "Zoya", phone: "9876543210" });
  assert.equal(users[2].firstName, "Zoya");
  assert.equal(users[2].phone, "");
});
