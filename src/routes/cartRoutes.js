const express = require("express");
const router = express.Router();

const cartController = require("../controllers/cartController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Cart
 *   description: Customer Shopping Cart APIs
 */

/**
 * @swagger
 * /api/v1/cart:
 *   get:
 *     summary: Get logged-in customer's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart fetched successfully.
 */
router.get("/", authMiddleware, cartController.getCart);

/**
 * @swagger
 * /api/v1/cart/{productId}:
 *   post:
 *     summary: Add product to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: integer
 *                 example: 2
 *               variantId:
 *                 type: string
 *                 description: Chosen option (weight, size …). Required for products with options.
 *                 example: "7027"
 *     responses:
 *       201:
 *         description: Product added successfully.
 */
router.post("/:productId", authMiddleware, cartController.addToCart);

/**
 * @swagger
 * /api/v1/cart/{productId}:
 *   patch:
 *     summary: Update product quantity
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: integer
 *                 example: 3
 *               variantId:
 *                 type: string
 *                 description: Option of the cart line to update ("" or omitted for products without options).
 *     responses:
 *       200:
 *         description: Cart quantity updated.
 */
router.patch("/:productId", authMiddleware, cartController.updateQuantity);

/**
 * @swagger
 * /api/v1/cart/{productId}:
 *   delete:
 *     summary: Remove product from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *       - in: query
 *         name: variant
 *         required: false
 *         schema:
 *           type: string
 *         description: Option of the cart line to remove (products with options).
 *     responses:
 *       200:
 *         description: Product removed successfully.
 */
router.delete("/:productId", authMiddleware, cartController.removeFromCart);

/**
 * @swagger
 * /api/v1/cart:
 *   delete:
 *     summary: Clear customer cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully.
 */
router.delete("/", authMiddleware, cartController.clearCart);

module.exports = router;