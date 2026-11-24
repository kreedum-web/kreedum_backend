const express = require("express");
const router = express.Router();

const searchController = require("../controllers/searchController");

/**
 * @swagger
 * tags:
 *   name: Search
 *   description: Global Product Search APIs for Kreedum Ecommerce
 */

/**
 * @swagger
 * /api/v1/search:
 *   get:
 *     summary: Search products across the Kreedum catalog.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search keyword (product name, SKU, brand, keyword).
 *         example: treadmill
 *
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: "One brand slug or several, comma-separated. The response's facets list the brands (with counts) and price range of the matches."
 *         example: aerofit,cockatoo
 *
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Department slug.
 *         example: cardio
 *
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Parent or child category slug.
 *         example: commercial-treadmill
 *
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: integer
 *         description: Minimum selling price.
 *         example: 20000
 *
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: integer
 *         description: Maximum selling price.
 *         example: 80000
 *
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum:
 *             - relevance
 *             - newest
 *             - price_low_high
 *             - price_high_low
 *             - discount
 *             - featured
 *             - popular
 *         description: Sorting option.
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *
 *     responses:
 *       200:
 *         description: Products fetched successfully.
 */
router.get("/", searchController.searchProducts);

/**
 * @swagger
 * /api/v1/search/suggestions:
 *   get:
 *     summary: Product autocomplete suggestions.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Keyword for autocomplete.
 *         example: tre
 *     responses:
 *       200:
 *         description: Suggestions fetched successfully.
 */
router.get("/suggestions", searchController.getSuggestions);

/**
 * @swagger
 * /api/v1/search/popular:
 *   get:
 *     summary: Popular searches shown on homepage.
 *     tags: [Search]
 *     responses:
 *       200:
 *         description: Popular searches fetched successfully.
 */
router.get("/popular", searchController.getPopularSearches);

module.exports = router;