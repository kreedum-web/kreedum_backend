const mongoose = require("mongoose");

/**
 * A note the team writes after contacting a customer, e.g. about the items
 * left in their cart ("Called, will order on Friday"). Shown on the
 * dashboard's Carts & wishlists page.
 */
const followUpSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    about: { type: String, enum: ["cart", "wishlist", "general"], default: "cart" },
    note: { type: String, required: true, trim: true, maxlength: 1000 },
    // How they were contacted
    channel: { type: String, enum: ["call", "whatsapp", "email", "other"], default: "call" },
    // Admin who wrote it
    by: { type: String, default: "" },
  },
  { timestamps: true, collection: "follow_ups" }
);

module.exports = mongoose.model("FollowUp", followUpSchema);
