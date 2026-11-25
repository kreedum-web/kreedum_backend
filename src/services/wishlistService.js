const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

class WishlistService {

  // ----------------------------
  // Get Customer Wishlist
  // ----------------------------
  async getWishlist(userId) {
    const wishlist = await Wishlist.find({ user: userId })
      .populate({
        path: "product",
        match: {
          isActive: true,
          visibility: "published",
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    const products = wishlist
      .filter((item) => item.product)
      .map((item) => ({
        wishlistId: item._id,
        addedAt: item.createdAt,
        ...item.product,
      }));

    return {
      totalItems: products.length,
      products,
    };
  }

  // ----------------------------
  // Add Product to Wishlist
  // ----------------------------
  async addToWishlist(userId, productId) {
    const product = await Product.findById(productId);

    if (!product || !product.isActive || product.visibility !== "published") {
      throw new Error("Product not found.");
    }

    const existing = await Wishlist.findOne({
      user: userId,
      product: productId,
    });

    if (existing) {
      throw new Error("Product already exists in wishlist.");
    }

    const wishlistItem = await Wishlist.create({
      user: userId,
      product: productId,
    });

    return wishlistItem;
  }

  // ----------------------------
  // Remove Product from Wishlist
  // ----------------------------
  async removeFromWishlist(userId, productId) {
    const deleted = await Wishlist.findOneAndDelete({
      user: userId,
      product: productId,
    });

    if (!deleted) {
      throw new Error("Product not found in wishlist.");
    }

    return deleted;
  }

  // ----------------------------
  // Check Wishlist Status
  // ----------------------------
  /**
   * Ids of every product in the customer's wishlist: one request lets the
   * website mark all product cards (instead of one request per card).
   */
  async wishlistIds(userId) {
    const items = await Wishlist.find({ user: userId }, { product: 1, _id: 0 }).lean();
    return { productIds: items.map((item) => String(item.product)) };
  }

  async checkWishlist(userId, productId) {
    const exists = await Wishlist.exists({
      user: userId,
      product: productId,
    });

    return {
      wishlisted: Boolean(exists),
    };
  }
}

module.exports = new WishlistService();