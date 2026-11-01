const mongoose = require("mongoose");

/** Institution logo in the home page clients strip. Logo in Cloudinary folder kreedum/clients. */
const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "clients" }
);

module.exports = mongoose.model("Client", clientSchema);
