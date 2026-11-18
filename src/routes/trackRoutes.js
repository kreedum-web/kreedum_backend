const express = require("express");
const router = express.Router();

const rateLimit = require("../middleware/rateLimit");
const { recordView } = require("../services/trackingService");

/**
 * @swagger
 * /api/v1/track:
 *   post:
 *     summary: Count one page view on the store (for the admin Traffic page)
 *     tags: [Site]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               visitorId: { type: string, example: "k7f3a9c2e1b04d6f" }
 *               path: { type: string, example: "/category/gym-equipment" }
 *               referrer: { type: string, example: "https://www.google.com/" }
 *     responses:
 *       204:
 *         description: Counted (or quietly ignored).
 */
router.post(
  "/",
  rateLimit({ name: "track", max: 120, minutes: 1, message: "Too many requests." }),
  async (req, res) => {
    try {
      await recordView(req.body || {}, { userAgent: req.get("user-agent") || "" });
    } catch (error) {
      console.error("Page view not saved:", error.message);
    }
    // Always "fine": the website never waits on or reacts to tracking.
    res.status(204).end();
  }
);

module.exports = router;
