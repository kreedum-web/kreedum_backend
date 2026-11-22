const express = require("express");
const router = express.Router();

const enquiryController = require("../controllers/enquiryController");
const rateLimit = require("../middleware/rateLimit");
const optionalAuth = require("../middleware/optionalAuth");

/**
 * @swagger
 * tags:
 *   name: Enquiries
 *   description: Bulk / quote enquiries from the website (no sign-in)
 */

/**
 * @swagger
 * /api/v1/enquiries:
 *   post:
 *     summary: Save a bulk enquiry
 *     description: Saved in the "enquiries" collection, with signedIn / user when the customer was signed in (send the usual Bearer token). The website then opens WhatsApp with the same details.
 *     tags: [Enquiries]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, city, equipmentNeed]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string, example: "9876543210" }
 *               email: { type: string }
 *               city: { type: string }
 *               organisation: { type: string }
 *               facilityType: { type: string }
 *               equipmentNeed: { type: string }
 *               budget: { type: string }
 *               timeline: { type: string }
 *               message: { type: string }
 *     responses:
 *       201: { description: Enquiry saved }
 *       400: { description: A field is missing or invalid }
 *       429: { description: Too many enquiries from this visitor }
 */
router.post(
  "/",
  rateLimit({ name: "enquiries", max: 10, minutes: 30, message: "You've sent a few enquiries already. Please call us or try again later." }),
  optionalAuth,
  enquiryController.create
);

/**
 * @swagger
 * /api/v1/enquiries/contact:
 *   post:
 *     summary: Save a Contact Us message (the website then opens WhatsApp)
 *     tags: [Enquiries]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, message]
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               topic: { type: string, example: "Order support" }
 *               message: { type: string }
 *     responses:
 *       201: { description: Saved }
 *       400: { description: A field is missing or invalid }
 */
router.post(
  "/contact",
  rateLimit({ name: "contact", max: 10, minutes: 30, message: "You've sent a few messages already. Please call us or try again later." }),
  optionalAuth,
  enquiryController.contact
);

/**
 * @swagger
 * /api/v1/enquiries/whatsapp:
 *   post:
 *     summary: Record that a WhatsApp button was pressed (for the admin dashboard)
 *     tags: [Enquiries]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               visitorId: { type: string }
 *               source: { type: string, enum: [floating, product-page, product-card, footer, contact-page, bulk-page, order-help, other] }
 *               productSlug: { type: string }
 *               sku: { type: string }
 *               quantity: { type: number }
 *               orderNumber: { type: string }
 *               page: { type: string }
 *     responses:
 *       204: { description: Recorded (or quietly ignored) }
 */
router.post(
  "/whatsapp",
  rateLimit({ name: "whatsapp-click", max: 30, minutes: 10, message: "Too many requests." }),
  optionalAuth,
  enquiryController.whatsapp
);

module.exports = router;
