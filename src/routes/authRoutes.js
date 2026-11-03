const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const rateLimit = require("../middleware/rateLimit");

// Per visitor (IP): requests that send an email/SMS, and password attempts.
const sendsCode = rateLimit({ name: "codes", max: 8, minutes: 15, message: "Too many codes requested. Please wait 15 minutes and try again." });
const checksCode = rateLimit({ name: "code-checks", max: 30, minutes: 15 });
const passwordTries = rateLimit({ name: "logins", max: 20, minutes: 15, message: "Too many sign-in attempts. Please wait 15 minutes or reset your password." });
const lookups = rateLimit({ name: "lookups", max: 60, minutes: 15 });

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: |
 *     Customers sign in with the email or mobile number they signed up with, plus a password
 *     (or Continue with Google). A one-time code is sent only when creating an account or
 *     setting / resetting a password.
 */

/**
 * @swagger
 * /api/v1/auth/options:
 *   get:
 *     summary: Sign-in options the website should show (Google client id, mobile numbers via Firebase or SMS)
 *     tags: [Authentication]
 */
router.get("/options", authController.options);

/**
 * @swagger
 * /api/v1/auth/identify:
 *   post:
 *     summary: Is this email / mobile number already a customer? (returns type, exists, hasPassword)
 *     tags: [Authentication]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               identifier: { type: string, example: "asha@gmail.com or 9876543210" }
 */
router.post("/identify", lookups, authController.identify);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Sign in with email or mobile number + password (no code)
 *     tags: [Authentication]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               identifier: { type: string, example: "asha@gmail.com" }
 *               password: { type: string }
 */
router.post("/login", passwordTries, authController.login);

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Create an account with email + password; emails a 6-digit code (finish with /auth/verify-email)
 *     tags: [Authentication]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 */
router.post("/register", sendsCode, authController.register);

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: Finish an email sign-up with the emailed code (returns token, isNew)
 *     tags: [Authentication]
 */
router.post("/verify-email", checksCode, authController.verifyEmail);

/**
 * @swagger
 * /api/v1/auth/resend-code:
 *   post:
 *     summary: Email a new sign-up code
 *     tags: [Authentication]
 */
router.post("/resend-code", sendsCode, authController.resendCode);

/**
 * @swagger
 * /api/v1/auth/register-phone:
 *   post:
 *     summary: Create an account with mobile number + password after the SMS code (idToken from Firebase, or phone + code)
 *     tags: [Authentication]
 */
router.post("/register-phone", checksCode, authController.registerPhone);

/**
 * @swagger
 * /api/v1/auth/phone/start:
 *   post:
 *     summary: Send an SMS code with our own SMS provider (not used while Firebase sends the codes)
 *     tags: [Authentication]
 */
router.post("/phone/start", sendsCode, authController.startPhoneCode);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Email a code to set or reset the password
 *     tags: [Authentication]
 */
router.post("/forgot-password", sendsCode, authController.forgotPassword);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Set a new password with the emailed code (returns token)
 *     tags: [Authentication]
 */
router.post("/reset-password", checksCode, authController.resetPassword);

/**
 * @swagger
 * /api/v1/auth/reset-password-phone:
 *   post:
 *     summary: Set a new password after the SMS code (idToken from Firebase, or phone + code; returns token)
 *     tags: [Authentication]
 */
router.post("/reset-password-phone", checksCode, authController.resetPasswordWithPhone);

/**
 * @swagger
 * /api/v1/auth/google:
 *   post:
 *     summary: Continue with Google (credential = ID token from Google's button; returns token, isNew)
 *     tags: [Authentication]
 */
router.post("/google", checksCode, authController.googleLogin);

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Logged-in customer (includes loginMethod, hasPassword)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.get("/me", authMiddleware, authController.getProfile);

/**
 * @swagger
 * /api/v1/auth/profile:
 *   put:
 *     summary: Update name, contact phone (not the sign-in number) and birthday
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.put("/profile", authMiddleware, authController.updateProfile);

/**
 * @swagger
 * /api/v1/auth/password:
 *   put:
 *     summary: Change the password (currentPassword needed if one is set) or set the first one
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 */
router.put("/password", authMiddleware, passwordTries, authController.changePassword);

module.exports = router;
