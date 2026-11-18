const authMiddleware = require("./authMiddleware");

/**
 * Admin dashboard routes: a signed-in, active account with role "admin".
 * Make an account admin with: npm run admin:make -- owner@example.com
 *
 *   router.use(adminOnly)
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin" || req.user?.isActive === false) {
    return res.status(403).json({ success: false, message: "Admins only.", code: "NOT_ADMIN" });
  }
  return next();
}

module.exports = [authMiddleware, requireAdmin];
module.exports.requireAdmin = requireAdmin;
