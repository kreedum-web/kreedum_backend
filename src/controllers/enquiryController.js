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

  /** POST /api/v1/enquiries/contact — Contact Us form. */
  async contact(req, res) {
    try {
      const data = await enquiryService.submitContact(req.body, { user: req.user || null, ip: req.ip });
      return res.status(201).json({ success: true, message: "Message saved.", data });
    } catch (error) {
      if (!error.status) console.error("Contact enquiry error:", error);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status ? error.message : "Couldn't save your message.",
        ...(error.code ? { code: error.code } : {}),
      });
    }
  }

  /** POST /api/v1/enquiries/whatsapp — a WhatsApp button was pressed. Always 204. */
  async whatsapp(req, res) {
    try {
      await enquiryService.logWhatsappClick(req.body || {}, { user: req.user || null, ip: req.ip });
    } catch (error) {
      console.error("WhatsApp enquiry not saved:", error.message);
    }
    return res.status(204).end();
  }
}

module.exports = new EnquiryController();
