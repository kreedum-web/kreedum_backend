const mongoose = require("mongoose");

/**
 * An alert for the admin dashboard (bell + Notifications page): new order,
 * order cancelled by the customer, new enquiry …
 *
 * Kept small on purpose: MongoDB deletes each one 2 days after it was made
 * (TTL index), and only the newest 20 are kept (notificationService).
 */
const KEEP_DAYS = 2;

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["NEW_ORDER", "ORDER_CANCELLED", "BULK_ENQUIRY", "CONTACT_ENQUIRY", "PRODUCT_ENQUIRY", "WHATSAPP_ENQUIRY"],
      required: true,
    },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, default: "", maxlength: 300 },
    // Where clicking it goes in the dashboard, e.g. "/orders/64b…"
    link: { type: String, default: "" },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "notifications", versionKey: false }
);

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model("Notification", notificationSchema);
module.exports.KEEP_DAYS = KEEP_DAYS;
