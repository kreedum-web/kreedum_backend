const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Like authMiddleware, but never blocks: a signed-in customer gets req.user,
 * anyone else (no token, expired token) just carries on without it.
 */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user) req.user = user;
  } catch {
    // not signed in (or an old token): fine here
  }
  return next();
}

module.exports = optionalAuth;
