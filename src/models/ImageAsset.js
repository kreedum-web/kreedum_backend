const mongoose = require("mongoose");

/**
 * One product photo copied from the supplier to Kreedum's own image storage
 * (Cloudinary). The catalogue keeps pointing at `url`; `sourceUrl` is where
 * the photo came from, so every catalogue rebuild can swap supplier
 * addresses for our own (src/utils/productImages.js).
 */
const imageAssetSchema = new mongoose.Schema(
  {
    sourceUrl: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
  },
  { timestamps: true, collection: "image_assets" }
);

module.exports = mongoose.model("ImageAsset", imageAssetSchema);
