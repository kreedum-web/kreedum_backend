const User = require("../models/User");

// Older unique email indexes counted accounts without an email as duplicates,
// which would allow only one phone-only account. They're replaced by
// user_email_unique_v2 (see the User model). MongoDB never drops an index by
// itself, so this runs at server start; it does nothing once done.
const OLD_INDEXES = ["user_email_unique", "email_1"];

async function ensureUserIndexes() {
  try {
    const indexes = await User.collection.indexes();
    for (const index of indexes) {
      if (OLD_INDEXES.includes(index.name) && !index.partialFilterExpression) {
        await User.collection.dropIndex(index.name);
        console.log(`👤 Users: dropped old index ${index.name}`);
      }
    }
  } catch (error) {
    // Collection not created yet: nothing to drop.
    if (error.codeName !== "NamespaceNotFound" && error.code !== 26) throw error;
  }

  await User.createIndexes();
}

module.exports = ensureUserIndexes;
