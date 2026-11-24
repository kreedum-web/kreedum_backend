const mongoose = require("mongoose");

/**
 * A product row on the website's home page ("Best Sellers", "Summer Season"…).
 *
 * Each row shows the products the admin picked first, then fills up to
 * `limit` by its rule:
 *   featured      picks: products ticked Featured;    then the most popular
 *   bestsellers   picks: ticked Best seller;          then most ordered / enquired (90 days)
 *   new           picks: ticked New arrival;          then newest in the catalogue
 *   trending      picks: ticked Trending;             then most viewed (14 days)
 *   deals         picks: productIds;                  then biggest discounts (changes daily)
 *   ready-stock   products marked "Ready stock" (in our store, fastest delivery)
 *   custom        picks: productIds;                  then `filters` (category, brands, price…)
 *
 * Built-in rows are created by themselves and can be renamed, hidden and
 * moved but not deleted; custom rows (e.g. a season) can have dates.
 */
const homeSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    rule: {
      type: String,
      enum: ["featured", "bestsellers", "new", "trending", "deals", "ready-stock", "custom"],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    subtitle: { type: String, default: "", trim: true, maxlength: 160 },
    isVisible: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
    limit: { type: Number, default: 8, min: 4, max: 16 },

    // Picked products, in order (deals and custom rows).
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // custom rows: how to fill up after the picks
    autoFill: { type: Boolean, default: true },
    filters: {
      categorySlug: { type: String, default: "" },
      brandSlugs: { type: [String], default: [] },
      minPrice: { type: Number, default: null },
      maxPrice: { type: Number, default: null },
      minDiscount: { type: Number, default: null },
      readyStockOnly: { type: Boolean, default: false },
      sort: { type: String, enum: ["popular", "newest", "discount", "price_low", "price_high"], default: "popular" },
    },

    // Shown only between these dates when set (seasonal rows).
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "home_sections" }
);

homeSectionSchema.index({ isVisible: 1, displayOrder: 1 });

module.exports = mongoose.model("HomeSection", homeSectionSchema);
