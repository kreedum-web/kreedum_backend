const siteContentService = require("../services/siteContentService");

class SiteController {
  /**
   * GET /api/v1/site
   * Announcements, leaders and clients. A section is null while it hasn't
   * been set up in the database (the website then uses its built-in content).
   */
  async getSiteContent(req, res) {
    try {
      const data = await siteContentService.getSiteContent();
      res.set("Cache-Control", "public, max-age=300");
      return res.status(200).json({ success: true, message: "Site content fetched successfully.", data });
    } catch (error) {
      console.error("Site content error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch site content." });
    }
  }
}

module.exports = new SiteController();
