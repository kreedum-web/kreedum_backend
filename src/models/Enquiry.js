const mongoose = require("mongoose");

/**
 * A bulk / quote enquiry from the website's "Bulk Enquiry" form, saved the
 * moment the customer presses "Send enquiry" (WhatsApp then opens with the
 * same details). No account needed; signedIn / user say whether they were
 * signed in.
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
    signedIn: { type: Boolean, default: false, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // the account's sign-in email / number at the time (when signed in)
    accountLogin: { type: String, default: "" },
    status: { type: String, enum: ["NEW", "CONTACTED", "CLOSED"], default: "NEW" },
    ip: { type: String, default: "", select: false },
  },
  { timestamps: true, collection: "enquiries" }
);

module.exports = mongoose.model("Enquiry", enquirySchema);
