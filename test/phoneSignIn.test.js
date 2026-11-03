// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const phoneAuth = require("../src/utils/phoneAuth");

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
User.findOne = (q) => {
  const row = users.find((u) => matches(u, q)) || null;
  return { select: async () => row, then: (res, rej) => Promise.resolve(row).then(res, rej) };
};
User.create = async (data) => {
  const row = asDoc({ _id: `u${users.length + 1}`, firstName: "", phone: "", role: "customer", isActive: true, ...data });
  users.push(row);
  return row;
};

const sms = [];
phoneAuth.setTestSmsSender(async (message) => sms.push(message));

const reset = () => {
  codes.length = 0;
  users.length = 0;
  sms.length = 0;
};

const auth = require("../src/services/authService");

const withEnv = (t, values) => {
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
};

// ---------------------------------------------------------------- numbers & settings

test("Indian mobile numbers are cleaned up; others refused", () => {
  for (const input of ["9876543210", "+91 98765 43210", "91-9876543210", "09876543210", " 98765-43210 "]) {
    assert.equal(phoneAuth.normalizeIndianPhone(input), "9876543210", input);
  }
  for (const input of ["", "12345", "5876543210", "+1 415 555 0100", "98765432101"]) {
    assert.equal(phoneAuth.normalizeIndianPhone(input), null, input);
  }
});

test("which phone sign-in is on depends on .env", () => {
  assert.equal(phoneAuth.phoneProvider({}), null);
  assert.equal(phoneAuth.phoneProvider({ SMS_TRANSPORT: "log" }), "sms");
  const firebase = { FIREBASE_PROJECT_ID: "kreedum-sports", FIREBASE_API_KEY: "AIzaTest", SMS_TRANSPORT: "log" };
  assert.equal(phoneAuth.phoneProvider(firebase), "firebase");
  assert.equal(phoneAuth.phoneProvider({ ...firebase, PHONE_PROVIDER: "sms" }), "sms");
  assert.equal(phoneAuth.phoneProvider({ ...firebase, PHONE_PROVIDER: "off" }), null);
  assert.deepEqual(phoneAuth.firebaseWebConfig(firebase), {
    apiKey: "AIzaTest",
    authDomain: "kreedum-sports.firebaseapp.com",
    projectId: "kreedum-sports",
  });
});

// ---------------------------------------------------------------- own SMS

test("own SMS: code by SMS creates a phone-only account; signing in again finds it", async (t) => {
  withEnv(t, { PHONE_PROVIDER: "sms", FIREBASE_PROJECT_ID: undefined });
  reset();
  assert.deepEqual(await auth.startPhoneLogin("+91 98765 43210"), { sent: true, phone: "9876543210" });
  assert.equal(sms[0].to, "+919876543210");
  const code = sms[0].text.match(/\b(\d{6})\b/)[1];

  const first = await auth.verifyPhoneLogin("9876543210", code);
  assert.equal(first.isNew, true);
  assert.ok(first.token);
  assert.equal(first.user.phone, "9876543210");
  assert.equal(first.user.email, undefined);
  assert.equal(users[0].phoneVerified, true);

  codes[0].lastSentAt = new Date(Date.now() - 2 * 60 * 1000);
  await auth.startPhoneLogin("9876543210");
  const again = await auth.verifyPhoneLogin("9876543210", sms.at(-1).text.match(/\b(\d{6})\b/)[1]);
  assert.equal(again.isNew, false);
  assert.equal(users.length, 1);
});

test("own SMS: wrong code counted, bad numbers refused, an unverified phone on another account isn't taken over", async (t) => {
  withEnv(t, { PHONE_PROVIDER: "sms" });
  reset();
  await assert.rejects(auth.startPhoneLogin("12345"), /valid 10-digit/);
  // someone typed this number in their profile without verifying it
  users.push(asDoc({ _id: "typed", email: "a@x.com", phone: "9123456780", isActive: true }));
  await auth.startPhoneLogin("9123456780");
  const code = sms[0].text.match(/\b(\d{6})\b/)[1];
  await assert.rejects(auth.verifyPhoneLogin("9123456780", code === "000000" ? "111111" : "000000"), /Wrong code/);
  const result = await auth.verifyPhoneLogin("9123456780", code);
  assert.equal(result.isNew, true);
  assert.notEqual(String(result.user.id), "typed");
});

test("own SMS endpoints are refused while Firebase is the provider", async (t) => {
  withEnv(t, { PHONE_PROVIDER: "firebase" });
  await assert.rejects(auth.startPhoneLogin("9876543210"), /Firebase/);
});

// ---------------------------------------------------------------- Firebase

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PROJECT = "kreedum-sports";
const realFetch = global.fetch;

function firebaseToken(claims = {}, { key = privateKey, kid = "k1" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: "fb-uid-1", phone_number: "+919876543210", auth_time: now - 5, firebase: { sign_in_provider: "phone" }, ...claims },
    key,
    { algorithm: "RS256", keyid: kid, audience: PROJECT, issuer: `https://securetoken.google.com/${PROJECT}`, expiresIn: 3600 }
  );
}

function firebaseSetup(t) {
  withEnv(t, { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_API_KEY: "AIzaTest", PHONE_PROVIDER: undefined });
  phoneAuth.resetFirebaseCerts();
  let calls = 0;
  global.fetch = async (url) => {
    assert.match(String(url), /securetoken@system\.gserviceaccount\.com/);
    calls++;
    return {
      ok: true,
      headers: { get: () => "public, max-age=19000" },
      json: async () => ({ k1: publicKey.export({ type: "spki", format: "pem" }) }),
    };
  };
  t.after(() => (global.fetch = realFetch));
  return () => calls;
}

test("Firebase: a genuine token signs in by phone (new account, then the same one); keys are cached", async (t) => {
  const calls = firebaseSetup(t);
  reset();
  const first = await auth.firebasePhoneLogin(firebaseToken());
  assert.equal(first.isNew, true);
  assert.equal(first.user.phone, "9876543210");
  const second = await auth.firebasePhoneLogin(firebaseToken());
  assert.equal(second.isNew, false);
  assert.equal(users.length, 1);
  assert.equal(calls(), 1);
});

test("Firebase: forged, wrong-project, expired or non-Indian tokens are refused", async (t) => {
  firebaseSetup(t);
  reset();
  const bad = [
    firebaseToken({}, { key: otherKeys.privateKey }), // not signed by Google
    firebaseToken({}, { kid: "unknown" }),
    jwt.sign({ sub: "x", phone_number: "+919876543210" }, privateKey, {
      algorithm: "RS256", keyid: "k1", audience: "someone-else", issuer: "https://securetoken.google.com/someone-else", expiresIn: 60,
    }),
    jwt.sign({ sub: "x", phone_number: "+919876543210", exp: Math.floor(Date.now() / 1000) - 10 }, privateKey, {
      algorithm: "RS256", keyid: "k1", audience: PROJECT, issuer: `https://securetoken.google.com/${PROJECT}`,
    }),
    "not-a-token",
  ];
  for (const token of bad) await assert.rejects(auth.firebasePhoneLogin(token), /Phone verification failed/);
  await assert.rejects(auth.firebasePhoneLogin(firebaseToken({ phone_number: "+14155550100" })), /Indian mobile/);
  assert.equal(users.length, 0);
});

test("Firebase not set up: clear message", async (t) => {
  withEnv(t, { FIREBASE_PROJECT_ID: undefined, FIREBASE_API_KEY: undefined });
  await assert.rejects(auth.firebasePhoneLogin("x"), (error) => error.code === "PHONE_NOT_CONFIGURED");
});
