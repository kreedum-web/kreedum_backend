const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const { hasVariants, findVariant, pricing, resolveVariant } = require("../utils/productVariants");

const MAX_CART_QUANTITY = 5;

class CartService {

  // ==========================
  // Get Customer Cart
  // ==========================
  async getCart(userId) {
    const cartItems = await Cart.find({ user: userId })
      .populate({
        path: "product",
        match: {
          isActive: true,
          visibility: "published",
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    const products = [];
    const staleLines = [];
    let subtotal = 0;
    let totalItems = 0;

    for (const item of cartItems) {
      if (!item.product) continue;

      const variantId = item.variantId || "";
      const variant = findVariant(item.product, variantId);

      // The option is gone (Metro stopped selling that weight), or the line
      // was added before the product had options: it can't be priced, so
      // take it out and tell the customer to choose again.
      if (hasVariants(item.product) ? !variant : variantId) {
        staleLines.push(item);
        continue;
      }

      const price = pricing(item.product, variant);
      const total = price.sellingPrice * item.quantity;

      subtotal += total;
      totalItems += item.quantity;

      const { variants: _variants, ...product } = item.product;

      products.push({
        ...product,
        ...price,
        variantId,
        ...(variant && variant.inStock === false ? { stockStatus: "out_of_stock" } : {}),
        cartId: item._id,
        quantity: item.quantity,
        addedAt: item.createdAt,
        total,
      });
    }

    if (staleLines.length) {
      await Cart.deleteMany({ _id: { $in: staleLines.map((item) => item._id) } });
    }

    return {
      totalItems,
      subtotal,
      products,
      // Shown on the cart page (each product once).
      removedItems: [...new Map(staleLines.map((item) => [String(item.product._id), item.product])).values()].map(
        (product) => ({
          productId: product._id,
          name: product.name,
          slug: product.slug,
          reason: "Choose an option again: the one you picked is no longer available.",
        })
      ),
    };
  }

  // ==========================
  // Add Product to Cart
  // ==========================
  async addToCart(userId, productId, quantity = 1, variantId = "") {

if (!mongoose.Types.ObjectId.isValid(productId)) {
  throw new Error("Invalid product ID.");
}

    const product = await Product.findById(productId);

    if (!product || !product.isActive || product.visibility !== "published") {
      throw new Error("Product not found.");
    }

    if (quantity < 1) {
      throw new Error("Quantity must be at least 1.");
    }

    // Weight / size: required for products that have options.
    const variant = resolveVariant(product, variantId);
    const lineVariantId = variant ? variant.variantId : "";

    if (quantity > MAX_CART_QUANTITY) {
  throw new Error(
    `Maximum ${MAX_CART_QUANTITY} quantity allowed for a single product.`
  );
}

    const existingItem = await Cart.findOne({
      user: userId,
      product: productId,
      variantId: lineVariantId,
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;

if (newQuantity > MAX_CART_QUANTITY) {
  throw new Error(
    `Maximum ${MAX_CART_QUANTITY} quantity allowed for a single product.`
  );
}

      existingItem.quantity = newQuantity;
      await existingItem.save();

      return existingItem;
    }

    const cartItem = await Cart.create({
      user: userId,
      product: productId,
      variantId: lineVariantId,
      quantity,
    });

    return cartItem;
  }

  // ==========================
  // Update Cart Quantity
  // ==========================
  async updateQuantity(userId, productId, quantity, variantId = "") {
    if (quantity > MAX_CART_QUANTITY) {
  throw new Error(
    `Maximum ${MAX_CART_QUANTITY} quantity allowed for a single product.`
  );
}

    if (!mongoose.Types.ObjectId.isValid(productId)) {
  throw new Error("Invalid product ID.");
}

    const product = await Product.findById(productId);

    if (!product) {
      throw new Error("Product not found.");
    }

    if (quantity > product.stock) {
      throw new Error("Requested quantity exceeds available stock.");
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be at least 1.");
    }

    const cartItem = await Cart.findOne({
      user: userId,
      product: productId,
      variantId: String(variantId || ""),
    });

    if (!cartItem) {
      throw new Error("Product not found in cart.");
    }

    cartItem.quantity = quantity;
    await cartItem.save();

    return cartItem;
  }

  // ==========================
  // Remove Product from Cart
  // ==========================
  async removeFromCart(userId, productId, variantId = "") {

if (!mongoose.Types.ObjectId.isValid(productId)) {
  throw new Error("Invalid product ID.");
}

    const deleted = await Cart.findOneAndDelete({
      user: userId,
      product: productId,
      variantId: String(variantId || ""),
    });

    if (!deleted) {
      throw new Error("Product not found in cart.");
    }

    return deleted;
  }

  // ==========================
  // Clear Entire Cart
  // ==========================
  async clearCart(userId) {
    await Cart.deleteMany({
      user: userId,
    });

    return {
      success: true,
    };
  }
}

module.exports = new CartService();