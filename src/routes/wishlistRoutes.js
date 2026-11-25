const express = require("express");
const router = express.Router();

const wishlistController = require("../controllers/wishlistController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Wishlist
 *   description: Customer Wishlist APIs
 */

/**
 * @swagger
 * /api/v1/wishlist:
 *   get:
 *     summary: Get logged-in customer's wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wishlist fetched successfully.
 */
router.get("/", authMiddleware, wishlistController.getWishlist);

/**
 * @swagger
 * /api/v1/wishlist/{productId}:
 *   post:
 *     summary: Add product to wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *     responses:
 *       201:
 *         description: Product added successfully.
 */
router.post("/:productId", authMiddleware, wishlistController.addToWishlist);

/**
 * @swagger
 * /api/v1/wishlist/{productId}:
 *   delete:
 *     summary: Remove product from wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *     responses:
 *       200:
 *         description: Product removed successfully.
 */
router.delete("/:productId", authMiddleware, wishlistController.removeFromWishlist);

/**
 * @swagger
 * /api/v1/wishlist/check/{productId}:
 *   get:
 *     summary: Check whether product exists in wishlist
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: 68aa507292eba10c8a50b14f
 *     responses:
 *       200:
 *         description: Wishlist status returned.
 */
/**
 * @swagger
 * /api/v1/wishlist/ids:
 *   get:
 *     summary: Ids of all products in my wishlist (to mark product cards in one request)
 *     tags: [Wishlist]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ productIds: [...] }"
 */
router.get("/ids", authMiddleware, wishlistController.wishlistIds);

router.get(
  "/check/:productId",
  authMiddleware,
  wishlistController.checkWishlist
);

module.exports = router;