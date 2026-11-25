const mongoose = require("mongoose");

/**
 * A delivery company or aggregator the store ships with (Delhivery,
 * Shiprocket, own van…), set up in the admin. trackingUrl: the courier's
 * tracking page, with {id} where the tracking number goes, e.g.
 * "https://example.com/track/{id}"; it gives the customer a "Track" link.
 */
const courierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    trackingUrl: { type: String, default: "", trim: true, maxlength: 300 },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "couriers" }
);

module.exports = mongoose.model("Courier", courierSchema);
