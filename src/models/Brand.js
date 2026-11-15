const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Cloudinary address of the brand's logo (npm run brands:logos)
    logo: {
      type: String,
      default: "",
    },

    logoPublicId: {
      type: String,
      default: "",
    },

    description: {
      type: String,
      default: "",
    },

    seo: {
      title: String,
      description: String,
      keywords: [String],
    },

    productCount: {
      type: Number,
      default: 0,
    },

    featured: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "brands",
  }
);

module.exports = mongoose.model("Brand", brandSchema);