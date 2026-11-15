const enquiryService = require("../services/enquiryService");

class EnquiryController {
  /** POST /api/v1/enquiries — bulk enquiry form (no sign-in needed). */
  async create(req, res) {
    try {
      const data = await enquiryService.submitEnquiry(req.body, { ip: req.ip });
      return res.status(201).json({
        success: true,
        message: "Thank you! Our team will call you shortly.",
        data,
      });
    } catch (error) {
      if (!error.status) console.error("Enquiry error:", error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "Couldn't send your enquiry. Please try again or call us.",
        ...(error.code ? { code: error.code } : {}),
        ...(error.extra || {}),
      });
    }
  }
}

module.exports = new EnquiryController();
