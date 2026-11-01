const express = require("express");
const router = express.Router();

const siteController = require("../controllers/siteController");

/**
 * @swagger
 * tags:
 *   name: Site
 *   description: Content the owner manages (announcements, leaders, clients)
 */

/**
 * @swagger
 * /api/v1/site:
 *   get:
 *     summary: Announcements, leaders and clients
 *     description: Each section is null until it has been set up in the database.
 *     tags: [Site]
 *     responses:
 *       200:
 *         description: Site content fetched successfully.
 */
router.get("/", siteController.getSiteContent);

module.exports = router;
