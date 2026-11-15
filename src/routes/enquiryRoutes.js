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

module.exports = router;
