const mongoose = require("mongoose");

/**
 * Home page hero / offer banner. Shown in displayOrder while isActive, and
 * only between startsAt and endsAt when those are set (for timed offers).
 * Image lives in Cloudinary folder kreedum/homepage/hero.
 */
const heroBannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },
    buttonText: { type: String, default: "", trim: true },
    buttonLink: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "hero_banners" }
);

heroBannerSchema.index({ isActive: 1, displayOrder: 1 });

module.exports = mongoose.model("HeroBanner", heroBannerSchema);
