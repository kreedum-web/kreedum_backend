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
    // "admin": created in the admin dashboard (kept by every catalogue rebuild)
    addedBy: {
      type: String,
      default: "",
    },

    // Fields changed in the admin dashboard (name, displayOrder, isActive):
    // the catalogue rebuild keeps them.
    adminLocked: {
      type: [String],
      default: [],
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