const mongoose = require("mongoose");

/**
 * A bulk / quote enquiry from the website's "Bulk enquiry" form.
 * No account needed. Each one is also emailed to the team (ENQUIRY_EMAIL).
 */
const enquirySchema = new mongoose.Schema(
  {
    kind: { type: String, default: "bulk" },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    city: { type: String, default: "", trim: true },
    organisation: { type: String, default: "", trim: true },
    facilityType: { type: String, default: "" },
    equipmentNeed: { type: String, default: "" },
    budget: { type: String, default: "" },
    timeline: { type: String, default: "" },
    message: { type: String, default: "" },
    // the page the customer was on when they opened the form
    page: { type: String, default: "" },
    status: { type: String, enum: ["NEW", "CONTACTED", "CLOSED"], default: "NEW" },
    emailSent: { type: Boolean, default: false },
    ip: { type: String, default: "", select: false },
  },
  { timestamps: true, collection: "enquiries" }
);

module.exports = mongoose.model("Enquiry", enquirySchema);
