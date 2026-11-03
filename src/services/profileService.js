const User = require("../models/User");
const Wishlist = require("../models/Wishlist");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Address = require("../models/Address");
const authService = require("./authService");

/**
 * The account pages (/profile). Profile and password rules live in
 * authService so /auth/profile and /profile behave the same.
 */
class ProfileService {

  async getProfile(userId) {
    return authService.getProfile(userId);
  }

  async updateProfile(userId, payload) {
    return authService.updateProfile(userId, payload);
  }

  // ===========================================
  // Dashboard Summary
  // ===========================================

  async getDashboard(userId) {

    const user = await User.findById(userId)
      .select("firstName lastName email phone role createdAt")
      .lean();

    if (!user) {
      throw new Error("User not found.");
    }

    const [wishlistItems, cartItems, totalOrders, defaultAddress] =
      await Promise.all([
        Wishlist.countDocuments({ user: userId }),
        Cart.countDocuments({ user: userId }),
        Order.countDocuments({ user: userId }),
        Address.findOne({
          user: userId,
          isDefault: true,
          isActive: true,
        }).lean(),
      ]);

    return {
      user,
      stats: {
        wishlistItems,
        cartItems,
        totalOrders,
      },
      defaultAddress,
    };
  }

  // Change the password, or set a first one (accounts without a password).
  async changePassword(userId, payload) {
    const result = await authService.changePassword(userId, payload);
    return { success: true, message: "Password saved.", data: result };
  }
}

module.exports = new ProfileService();
