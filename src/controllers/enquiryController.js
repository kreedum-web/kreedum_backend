const enquiryService = require("../services/enquiryService");

class EnquiryController {
  /** POST /api/v1/enquiries — bulk enquiry form (no sign-in needed). */
  async create(req, res) {
    try {
      const data = await enquiryService.submitEnquiry(req.body, { user: req.user || null, ip: req.ip });
      return res.status(201).json({
        success: true,
        message: "Enquiry saved.",
        data,
      });
    } catch (error) {
      if (!error.status) console.error("Enquiry error:", error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "Couldn't save your enquiry.",
        ...(error.code ? { code: error.code } : {}),
        ...(error.extra || {}),
      });
    }
  }
}

module.exports = new EnquiryController();
