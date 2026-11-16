const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    level: {
      type: Number,
      enum: [1, 2, 3],
      required: true,
    },

    parentSlug: String,

    rootSlug: String,

    path: [String],

    displayOrder: {
      type: Number,
      default: 0,
    },

    supplierCategories: {
      type: [String],
      default: [],
    },

    // "category-rule": added by src/config/categoryRules.js, not from Metro's menu
    addedBy: {
      type: String,
      default: "",
    },

    productCount: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Category", categorySchema);