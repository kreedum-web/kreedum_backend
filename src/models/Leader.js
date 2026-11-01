const mongoose = require("mongoose");

/** Leadership on the About Us page. Photo in Cloudinary folder kreedum/leaders. */
const leaderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "", trim: true },
    quote: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "leaders" }
);

module.exports = mongoose.model("Leader", leaderSchema);
