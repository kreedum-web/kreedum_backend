/**
 * Simple per-visitor (IP address) limit, kept in memory.
 *
 * Stops one visitor or bot from, for example, requesting codes for thousands
 * of email addresses (which would use up the daily Gmail limit) or guessing
 * passwords. Each limit counts separately. Fine for one server (Render
 * free); with several servers each would count on its own.
 *
 *   router.post("/register", rateLimit({ name: "codes", max: 8, minutes: 15 }), …)
 */
const buckets = new Map(); // "name|ip" → { count, resetAt }

function clientIp(req) {
  // Render sits in front of the app; app.set("trust proxy", 1) makes req.ip the visitor's address.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimit({ name, max, minutes, message = "Too many attempts. Please wait a few minutes and try again." }) {
  const windowMs = minutes * 60 * 1000;
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}|${clientIp(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ success: false, message, code: "RATE_LIMITED", retryAfter });
    }

    // Forget old entries now and then so memory stays small.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return next();
  };
}

/** Tests: start counting from zero. */
rateLimit.reset = () => buckets.clear();

module.exports = rateLimit;
