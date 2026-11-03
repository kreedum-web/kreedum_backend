// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/User");
const ensureUserIndexes = require("../src/utils/ensureUserIndexes");

test("old full email index is dropped, partial ones are created; second run changes nothing", async () => {
  let indexes = [
    { name: "_id_", key: { _id: 1 } },
    { name: "user_email_unique", key: { email: 1 }, unique: true },
  ];
  const dropped = [];
  Object.defineProperty(User, "collection", {
    configurable: true,
    value: {
      indexes: async () => indexes,
      dropIndex: async (name) => {
        dropped.push(name);
        indexes = indexes.filter((index) => index.name !== name);
      },
    },
  });
  let created = 0;
  User.createIndexes = async () => {
    created++;
    for (const [key, options] of User.schema.indexes()) {
      if (!indexes.some((index) => index.name === options.name)) indexes.push({ key, ...options });
    }
  };
  const log = console.log;
  console.log = () => {};
  try {
    await ensureUserIndexes();
    await ensureUserIndexes();
  } finally {
    console.log = log;
  }
  assert.deepEqual(dropped, ["user_email_unique"]);
  assert.equal(created, 2);
  const email = indexes.find((index) => index.name === "user_email_unique_v2");
  assert.deepEqual(email.partialFilterExpression, { email: { $type: "string" } });
  const phone = indexes.find((index) => index.name === "user_verified_phone_unique");
  assert.deepEqual(phone.partialFilterExpression, { phoneVerified: true });
});
