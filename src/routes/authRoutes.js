const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Customer Authentication APIs
 */

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new customer
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - email
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Vibhor
 *               lastName:
 *                 type: string
 *                 example: Jain
 *               email:
 *                 type: string
 *                 example: vibhor@example.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               password:
 *                 type: string
 *                 example: Password@123
 *     responses:
 *       201:
 *         description: Customer registered successfully.
 */
router.post("/register", authController.register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login customer
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: vibhor@example.com
 *               password:
 *                 type: string
 *                 example: Password@123
 *     responses:
 *       200:
 *         description: Login successful.
 */
router.post("/login", authController.login);

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: Finish sign-up with the 6-digit code emailed to the customer (returns token)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               code: { type: string, example: "482913" }
 */
router.post("/verify-email", authController.verifyEmail);

/**
 * @swagger
 * /api/v1/auth/resend-code:
 *   post:
 *     summary: Email a new sign-up code (at most once a minute, 5 an hour)
 *     tags: [Authentication]
 */
router.post("/resend-code", authController.resendCode);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Email a password reset code
 *     tags: [Authentication]
 */
router.post("/forgot-password", authController.forgotPassword);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Set a new password with the emailed code (returns token)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               code: { type: string }
 *               password: { type: string }
 */
router.post("/reset-password", authController.resetPassword);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get logged-in customer profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully.
 */
router.get("/me", authMiddleware, authController.getProfile);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     summary: Update logged-in customer profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Vibhor
 *               lastName:
 *                 type: string
 *                 example: Jain
 *               phone:
 *                 type: string
 *                 example: "9999999999"
 *               birthday:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *                 example: "1995-08-13"
 *     responses:
 *       200:
 *         description: Profile updated successfully.
 */
router.put("/profile", authMiddleware, authController.updateProfile);

module.exports = router;