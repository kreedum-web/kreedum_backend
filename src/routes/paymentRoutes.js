const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");
const rateLimit = require("../middleware/rateLimit");

const starts = rateLimit({ name: "payment-starts", max: 20, minutes: 15 });

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Online payment through Cashfree (UPI, cards, netbanking). Orders placed with paymentMethod ONLINE wait in AWAITING_PAYMENT until paid.
 */

/**
 * @swagger
 * /api/v1/payments/options:
 *   get:
 *     summary: Is online payment available ({ online, mode, payWithinMinutes })
 *     tags: [Payments]
 */
router.get("/options", paymentController.options);

/**
 * @swagger
 * /api/v1/payments/orders/{orderId}/start:
 *   post:
 *     summary: Payment session for an order waiting for payment ({ paymentSessionId, mode }) — open with Cashfree's JS checkout
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.post("/orders/:orderId/start", authMiddleware, starts, paymentController.start);

/**
 * @swagger
 * /api/v1/payments/orders/{orderId}/status:
 *   get:
 *     summary: Checks with Cashfree and returns the order's payment status (used by the return page)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 */
router.get("/orders/:orderId/status", authMiddleware, paymentController.status);

/**
 * @swagger
 * /api/v1/payments/cashfree/webhook:
 *   post:
 *     summary: Cashfree payment and refund notifications (signature checked)
 *     tags: [Payments]
 */
router.post("/cashfree/webhook", paymentController.webhook);

module.exports = router;
