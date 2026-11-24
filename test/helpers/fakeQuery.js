// A tiny MongoDB-style matcher for the in-memory fakes in the tests:
// { a: 1 }, { a: { $in: [...] } }, { a: { $ne: x } }, { a: { $nin: [...] } };
// an array field matches when one of its values does (as in MongoDB).
function matchesValue(value, condition) {
  const values = Array.isArray(value) ? value : [value];
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if ("$in" in condition) return values.some((v) => condition.$in.includes(v));
    if ("$nin" in condition) return !values.some((v) => condition.$nin.includes(v));
    if ("$ne" in condition) return !values.includes(condition.$ne);
  }
  return values.includes(condition);
}

// isActive is true when missing (the schema's default)
const valueOf = (doc, key) => (key === "isActive" && doc[key] === undefined ? true : doc[key]);
const matches = (doc, query = {}) => Object.entries(query).every(([k, c]) => matchesValue(valueOf(doc, k), c));

/** Model.find(query[, projection]).lean() over an array. */
const findIn = (docs) => (query = {}) => ({ lean: async () => docs.filter((d) => matches(d, query)) });

module.exports = { matches, findIn };
