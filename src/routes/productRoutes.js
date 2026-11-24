const express = require("express");

const router = express.Router();

const {
  getProducts,
  getProductBySlug,
} = require("../controllers/productController");


/**
 * @swagger
 * /api/v1/products:
 *   get:
 *     tags:
 *       - Products
 *     summary: Get paginated products
 *     description: Product listing API with filters and sorting.
 *     parameters:
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
 *           default: 20
 *
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *           enum:
 *             - cardio
 *             - strength-equipment
 *             - free-weights
 *             - sports-equipment
 *             - yoga-recovery
 *             - recovery
 *
 *       - in: query
 *         name: parentCategory
 *         schema:
 *           type: string
 *           enum:
 *             - treadmills
 *             - upright-bikes
 *             - spin-bikes
 *             - rowing-machines
 *             - benches-racks
 *             - home-gyms
 *             - pickleball
 *
 *       - in: query
 *         name: childCategory
 *         schema:
 *           type: string
 *           example: commercial-treadmill
 *
 *       - in: query
 *         name: brand
 *         description: One brand slug or several, comma-separated.
 *         schema:
 *           type: string
 *           example: aerofit,cockatoo
 *
 *       - in: query
 *         name: facets
 *         description: "true = also return facets: { brands: [{ slug, name, count }], price: { min, max } } for the filter panel."
 *         schema:
 *           type: string
 *           example: "true"
 *
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: integer
 *           example: 20000
 *
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: integer
 *           example: 50000
 *
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum:
 *             - latest
 *             - price_low_high
 *             - price_high_low
 *             - discount
 *             - popular
 *             - featured
 *
 *       - in: query
 *         name: featured
 *         schema:
 *           type: boolean
 *           default: false
 *
 *       - in: query
 *         name: bestSeller
 *         schema:
 *           type: boolean
 *           default: false
 *
 *       - in: query
 *         name: newArrival
 *         schema:
 *           type: boolean
 *           default: false
 *
 *       - in: query
 *         name: trending
 *         schema:
 *           type: boolean
 *           default: false
 *
 *       - in: query
 *         name: stockStatus
 *         schema:
 *           type: string
 *           enum:
 *             - in_stock
 *             - out_of_stock
 *             - enquiry_only
 *             - preorder
 *
 *     responses:
 *       200:
 *         description: Product list returned successfully.
 */

router.get("/", getProducts);

/**
 * @swagger
 * /api/v1/products/{slug}:
 *   get:
 *     tags: [Products]
 *     summary: Get a single product by slug
 *     description: Returns complete product information along with related products.
 *
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: aerofit-af-1-0-motorized-treadmill
 *
 *     responses:
 *       200:
 *         description: Product found successfully.
 *       404:
 *         description: Product not found.
 */

router.get("/:slug", getProductBySlug);


module.exports = router;