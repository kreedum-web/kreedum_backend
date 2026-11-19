const mongoose = require("mongoose");

/**
 * Something a visitor asked us, by kind:
 *   bulk      the "Bulk Enquiry" form (saved when they press "Send enquiry";
 *             WhatsApp then opens with the same details)
 *   contact   the Contact Us page form (same: saved, then WhatsApp opens)
 *   product   "Enquire Now" on a product page opened WhatsApp
 *   whatsapp  any other WhatsApp button (floating button, footer …)
 * For product / whatsapp we only know a chat was opened (the message itself
 * is in WhatsApp); name / phone are known when the visitor was signed in.
 * No account needed; signedIn / user say whether they were signed in.
 */
// Bulk and contact forms always have a name and phone; WhatsApp clicks may not.
function needsContact() {
  return this.kind === "bulk" || this.kind === "contact";
}

const enquirySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["bulk", "contact", "product", "whatsapp"], default: "bulk", index: true },
    name: { type: String, required: needsContact, trim: true, default: "" },
    phone: { type: String, required: needsContact, trim: true, default: "" },
    email: { type: String, default: "", trim: true, lowercase: true },
    city: { type: String, default: "", trim: true },
    organisation: { type: String, default: "", trim: true },
    facilityType: { type: String, default: "" },
    equipmentNeed: { type: String, default: "" },
    budget: { type: String, default: "" },
    timeline: { type: String, default: "" },
    message: { type: String, default: "" },
    // Contact form: what it's about (e.g. "Order support")
    topic: { type: String, default: "" },
    // product / whatsapp: which product (if any) and which button
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    productName: { type: String, default: "" },
    productSlug: { type: String, default: "" },
    sku: { type: String, default: "" },
    quantity: { type: Number, default: 0 },
    orderNumber: { type: String, default: "" },
    source: { type: String, default: "" },
    // Browser id (same as the Traffic page) so repeat clicks count once
    visitorId: { type: String, default: "", index: true },
    clicks: { type: Number, default: 1 },
    lastClickAt: { type: Date, default: null },
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
