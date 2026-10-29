const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    // Chosen option of a product sold in several weights / sizes
    // (Product.variants[].variantId); "" for products without options.
    variantId: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
    collection: "cart",
  }
);

// One cart line per product and option (5 kg and 10 kg of the same
// dumbbell are two lines). Replaces the old one-line-per-product index
// "cart_user_product_unique"; src/utils/ensureCartIndexes.js swaps them.
cartSchema.index(
  { user: 1, product: 1, variantId: 1 },
  {
    unique: true,
    name: "cart_user_product_variant_unique",
  }
);

module.exports = mongoose.model("Cart", cartSchema);