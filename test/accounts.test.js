// Run with: npm test
// Sign-in rules: one credential per account (email OR mobile number) + password;
// codes only to create an account or set / reset a password.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const phoneAuth = require("../src/utils/phoneAuth");
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
const asDoc = (row) => Object.assign(row, { async save() { return this; } });
const matches = (row, q) => Object.entries(q).every(([key, value]) => row[key] === value);
const query = (row) => ({ select: async () => row, then: (res, rej) => Promise.resolve(row).then(res, rej) });
User.findOne = (q) => query(users.find((u) => matches(u, q)) || null);
User.findById = (id) => query(users.find((u) => u._id === id) || null);
User.create = async (data) => {
  const row = asDoc({ _id: `u${users.length + 1}`, firstName: "", lastName: "", phone: "", role: "customer", isActive: true, ...data });
  users.push(row);
  return row;
};

const mailbox = [];
setTestTransport({ sendMail: async (message) => (mailbox.push(message), { messageId: "m" }) });
const sms = [];
phoneAuth.setTestSmsSender(async (message) => sms.push(message));
const lastCode = (list) => list.at(-1).text.match(/\b(\d{6})\b/)[1];

const reset = () => {
  codes.length = 0;
  users.length = 0;
  mailbox.length = 0;
  sms.length = 0;
};
const hash = (password) => bcrypt.hash(password, 4);

const auth = require("../src/services/authService");

function withEnv(t, values) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// ---------------------------------------------------------------- identify

test("email or mobile number is recognised in one box", () => {
  assert.deepEqual(auth.parseIdentifier(" Asha@Gmail.com "), { type: "email", value: "asha@gmail.com" });
  assert.deepEqual(auth.parseIdentifier("+91 98765 43210"), { type: "phone", value: "9876543210" });
  assert.equal(auth.parseIdentifier("asha@"), null);
  assert.equal(auth.parseIdentifier("12345"), null);
});

test("identify: new vs existing, with or without a password; unfinished email sign-ups count as new", async () => {
  reset();
  users.push(asDoc({ _id: "a", email: "asha@gmail.com", password: await hash("secret123") }));
  users.push(asDoc({ _id: "g", email: "gopal@gmail.com", googleId: "g-1" }));
  users.push(asDoc({ _id: "r", phone: "9876543210", phoneVerified: true, password: await hash("secret123") }));
  users.push(asDoc({ _id: "c", email: "contact@x.com", phone: "9123456789" })); // contact phone only
  users.push(asDoc({ _id: "u", email: "half@x.com", emailVerified: false, password: await hash("secret123") }));

  const pick = ({ type, exists, hasPassword }) => ({ type, exists, hasPassword });
  assert.deepEqual(pick(await auth.identify("asha@gmail.com")), { type: "email", exists: true, hasPassword: true });
  assert.deepEqual(pick(await auth.identify("gopal@gmail.com")), { type: "email", exists: true, hasPassword: false });
  assert.deepEqual(pick(await auth.identify("98765 43210")), { type: "phone", exists: true, hasPassword: true });
  // a phone typed in someone's profile/address is not a sign-in number
  assert.deepEqual(pick(await auth.identify("9123456789")), { type: "phone", exists: false, hasPassword: false });
  assert.deepEqual(pick(await auth.identify("half@x.com")), { type: "email", exists: false, hasPassword: false });
  assert.deepEqual(pick(await auth.identify("new@x.com")), { type: "email", exists: false, hasPassword: false });
  await assert.rejects(auth.identify("hello"), /valid email address or 10-digit mobile number/);
});

// ---------------------------------------------------------------- login

test("login: email + password and phone + password, no code sent", async () => {
  reset();
  users.push(asDoc({ _id: "a", email: "asha@gmail.com", password: await hash("secret123") }));
  users.push(asDoc({ _id: "r", phone: "9876543210", phoneVerified: true, password: await hash("phonepass1") }));

  const byEmail = await auth.login("Asha@gmail.com", "secret123");
  assert.equal(byEmail.user.loginMethod, "email");
  assert.equal(byEmail.user.hasPassword, true);
  const byPhone = await auth.login("+91 98765 43210", "phonepass1");
  assert.equal(byPhone.user.loginMethod, "phone");
  assert.equal(byPhone.user.phone, "9876543210");
  assert.equal(mailbox.length + sms.length, 0);
});

test("login: clear answers for wrong password, unknown account, no password, empty fields, disabled", async () => {
  reset();
  users.push(asDoc({ _id: "a", email: "asha@gmail.com", password: await hash("secret123") }));
  users.push(asDoc({ _id: "g", email: "gopal@gmail.com", googleId: "g-1" }));
  users.push(asDoc({ _id: "x", email: "off@x.com", password: await hash("secret123"), isActive: false }));
  const code = (promise) => promise.then(() => "ok", (error) => error.code);

  assert.equal(await code(auth.login("asha@gmail.com", "nope12345")), "WRONG_PASSWORD");
  assert.equal(await code(auth.login("nobody@x.com", "secret123")), "ACCOUNT_NOT_FOUND");
  assert.equal(await code(auth.login("9000000000", "secret123")), "ACCOUNT_NOT_FOUND");
  assert.equal(await code(auth.login("gopal@gmail.com", "secret123")), "NO_PASSWORD");
  assert.equal(await code(auth.login("", "secret123")), "INVALID_IDENTIFIER");
  assert.equal(await code(auth.login(undefined, "secret123")), "INVALID_IDENTIFIER");
  assert.equal(await code(auth.login("asha@gmail.com", "")), "PASSWORD_REQUIRED");
  assert.equal(await code(auth.login("off@x.com", "secret123")), "ACCOUNT_DISABLED");
});

// ---------------------------------------------------------------- email sign-up

test("email sign-up: password + one code → account (isNew), then password login works with no code", async () => {
  reset();
  await assert.rejects(auth.register({ email: "asha@gmail.com", password: "short" }), /at least 8/);
  assert.deepEqual(await auth.register({ email: "Asha@gmail.com", password: "secret123" }), {
    requiresVerification: true,
    email: "asha@gmail.com",
  });
  assert.equal(mailbox.length, 1);
  const done = await auth.verifyEmail("asha@gmail.com", lastCode(mailbox));
  assert.equal(done.isNew, true);
  assert.equal(done.user.firstName, "");

  const again = await auth.login("asha@gmail.com", "secret123");
  assert.ok(again.token);
  assert.equal(mailbox.length, 1); // no new code
  await assert.rejects(auth.register({ email: "asha@gmail.com", password: "another12" }), (e) => e.code === "ACCOUNT_EXISTS");
});

// ---------------------------------------------------------------- phone sign-up & reset

test("phone sign-up (own SMS): code proves the number, account gets the password; second sign-up refused", async (t) => {
  withEnv(t, { PHONE_PROVIDER: "sms" });
  reset();
  await auth.startPhoneCode("9876543210");
  await assert.rejects(auth.registerPhone({ phone: "9876543210", code: "000000", password: "short" }), /at least 8/);
  const created = await auth.registerPhone({ phone: "9876543210", code: lastCode(sms), password: "phonepass1" });
  assert.equal(created.isNew, true);
  assert.equal(created.user.loginMethod, "phone");
  assert.equal(created.user.hasPassword, true);
  assert.equal(users[0].email, undefined);

  assert.ok((await auth.login("9876543210", "phonepass1")).token);

  codes[0].lastSentAt = new Date(Date.now() - 2 * 60 * 1000);
  await auth.startPhoneCode("9876543210");
  await assert.rejects(
    auth.registerPhone({ phone: "9876543210", code: lastCode(sms), password: "phonepass2" }),
    (e) => e.code === "ACCOUNT_EXISTS"
  );
});

test("phone sign-up refuses a wrong code; an email account's contact phone doesn't block it", async (t) => {
  withEnv(t, { PHONE_PROVIDER: "sms" });
  reset();
  users.push(asDoc({ _id: "c", email: "contact@x.com", phone: "9123456780" }));
  await auth.startPhoneCode("9123456780");
  const right = lastCode(sms);
  await assert.rejects(auth.registerPhone({ phone: "9123456780", code: right === "000000" ? "111111" : "000000", password: "phonepass1" }), /Wrong code/);
  const created = await auth.registerPhone({ phone: "9123456780", code: right, password: "phonepass1" });
  assert.notEqual(String(created.user.id), "c");
  assert.equal(users.length, 2);
});

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PROJECT = "kreedum-backend";
const realFetch = global.fetch;
const firebaseToken = (phone = "+919876543210") =>
  jwt.sign({ sub: "fb-1", phone_number: phone, auth_time: Math.floor(Date.now() / 1000) - 5 }, privateKey, {
    algorithm: "RS256", keyid: "k1", audience: PROJECT, issuer: `https://securetoken.google.com/${PROJECT}`, expiresIn: 3600,
  });
function firebase(t) {
  withEnv(t, { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_API_KEY: "AIzaTest", PHONE_PROVIDER: undefined });
  phoneAuth.resetFirebaseCerts();
  global.fetch = async () => ({ ok: true, headers: { get: () => "max-age=600" }, json: async () => ({ k1: publicKey.export({ type: "spki", format: "pem" }) }) });
  t.after(() => (global.fetch = realFetch));
}

test("phone sign-up and reset with Firebase: the ID token proves the number", async (t) => {
  firebase(t);
  reset();
  const created = await auth.registerPhone({ idToken: firebaseToken(), password: "phonepass1" });
  assert.equal(created.user.phone, "9876543210");
  await assert.rejects(auth.registerPhone({ idToken: "forged", password: "phonepass1" }), /verification failed/);

  const reset1 = await auth.resetPasswordWithPhone({ idToken: firebaseToken(), password: "newpass123" });
  assert.ok(reset1.token);
  await assert.rejects(auth.login("9876543210", "phonepass1"), /Wrong password/);
  assert.ok((await auth.login("9876543210", "newpass123")).token);
  await assert.rejects(auth.resetPasswordWithPhone({ idToken: firebaseToken("+919000000000"), password: "newpass123" }), (e) => e.code === "ACCOUNT_NOT_FOUND");
});

test("phone sign-up without Firebase or SMS set up: clear message", async (t) => {
  withEnv(t, { FIREBASE_PROJECT_ID: undefined, FIREBASE_API_KEY: undefined, PHONE_PROVIDER: undefined, SMS_TRANSPORT: undefined });
  await assert.rejects(auth.registerPhone({ idToken: "x", password: "phonepass1" }), (e) => e.code === "PHONE_NOT_CONFIGURED");
});

// ---------------------------------------------------------------- set a password (older code-only / Google accounts)

test("an email account without a password sets one with the emailed reset code, then signs in normally", async () => {
  reset();
  users.push(asDoc({ _id: "o", email: "old@x.com" }));
  assert.equal((await auth.identify("old@x.com")).hasPassword, false);
  await auth.forgotPassword("old@x.com");
  await auth.resetPassword("old@x.com", lastCode(mailbox), "mynewpass1");
  assert.ok((await auth.login("old@x.com", "mynewpass1")).token);
});

// ---------------------------------------------------------------- profile

test("profile: the sign-in phone can't be changed; contact phone of email accounts can", async () => {
  reset();
  users.push(asDoc({ _id: "r", phone: "9876543210", phoneVerified: true, firstName: "" }));
  users.push(asDoc({ _id: "a", email: "asha@gmail.com", phone: "", firstName: "Asha" }));

  await assert.rejects(auth.updateProfile("r", { phone: "9000000001" }), (e) => e.code === "LOGIN_PHONE_LOCKED");
  assert.equal(users[0].phone, "9876543210");
  const same = await auth.updateProfile("r", { phone: "9876543210", firstName: "Ravi" });
  assert.equal(same.firstName, "Ravi");

  const updated = await auth.updateProfile("a", { phone: "+91 90000 00001" });
  assert.equal(updated.phone, "9000000001");
  assert.equal(users[1].phoneVerified, undefined); // a contact number never becomes a sign-in number
  await assert.rejects(auth.updateProfile("a", { firstName: "  " }), /can't be empty/);
});

test("change password needs the current one; accounts without one can set a first password", async () => {
  reset();
  users.push(asDoc({ _id: "a", email: "asha@gmail.com", password: await hash("secret123") }));
  users.push(asDoc({ _id: "g", email: "gopal@gmail.com", googleId: "g-1" }));

  await assert.rejects(auth.changePassword("a", { newPassword: "newpass123" }), /current password/);
  await assert.rejects(auth.changePassword("a", { currentPassword: "wrong1234", newPassword: "newpass123" }), /incorrect/);
  await assert.rejects(auth.changePassword("a", { currentPassword: "secret123", newPassword: "secret123" }), /different/);
  await assert.rejects(auth.changePassword("a", { currentPassword: "secret123", newPassword: "newpass123", confirmPassword: "x" }), /don't match/);
  await auth.changePassword("a", { currentPassword: "secret123", newPassword: "newpass123" });
  assert.ok((await auth.login("asha@gmail.com", "newpass123")).token);

  assert.deepEqual(await auth.changePassword("g", { newPassword: "googlepw1" }), { hasPassword: true });
  assert.ok((await auth.login("gopal@gmail.com", "googlepw1")).token);
});

// ---------------------------------------------------------------- addresses & limits

test("addresses: only address fields are saved (a request can't change the owner); email checked", async () => {
  const Address = require("../src/models/Address");
  const saved = [];
  Address.findOne = async () => null;
  Address.countDocuments = async () => 0;
  Address.create = async (data) => (saved.push(data), data);
  const service = require("../src/services/savedAddressService");
  const good = { fullName: "Ravi", phone: "9876543210", email: "Ravi@Gmail.com", addressLine1: "5 MG Road", locality: "Hazratganj", city: "Lucknow", district: "Lucknow", state: "UP", pincode: "226001" };

  await service.createAddress("me", { ...good, user: "someone-else", isActive: false, isDefault: true });
  assert.equal(saved[0].user, "me");
  assert.equal(saved[0].isActive, undefined);
  assert.equal(saved[0].email, "ravi@gmail.com");
  await assert.rejects(service.createAddress("me", { ...good, email: "ravi@" }), /valid email/);
  await assert.rejects(service.createAddress("me", { ...good, pincode: "12" }), /PIN code/);
  await assert.rejects(service.createAddress("me", { ...good, fullName: "" }), /Complete all required/);
});

test("rate limit: after the limit the visitor gets 429 with a wait time; other visitors unaffected", () => {
  const rateLimit = require("../src/middleware/rateLimit");
  rateLimit.reset();
  const limit = rateLimit({ name: "t", max: 2, minutes: 15 });
  const run = (ip) => {
    let status = 200;
    let body = null;
    const res = { set() {}, status(code) { status = code; return this; }, json(data) { body = data; return this; } };
    let passed = false;
    limit({ ip }, res, () => (passed = true));
    return { passed, status, body };
  };
  assert.equal(run("1.1.1.1").passed, true);
  assert.equal(run("1.1.1.1").passed, true);
  const third = run("1.1.1.1");
  assert.equal(third.status, 429);
  assert.equal(third.body.code, "RATE_LIMITED");
  assert.ok(third.body.retryAfter > 0);
  assert.equal(run("2.2.2.2").passed, true);
});
