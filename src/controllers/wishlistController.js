const wishlistService = require("../services/wishlistService");

class WishlistController {

  // GET /wishlist
  async getWishlist(req, res) {
    try {
      const wishlist = await wishlistService.getWishlist(req.user._id);

      return res.status(200).json({
        success: true,
        message: "Wishlist fetched successfully.",
        data: wishlist,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // POST /wishlist/:productId
  async addToWishlist(req, res) {
    try {
      const item = await wishlistService.addToWishlist(
        req.user._id,
        req.params.productId
      );

      return res.status(201).json({
        success: true,
        message: "Product added to wishlist.",
        data: item,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // DELETE /wishlist/:productId
  async removeFromWishlist(req, res) {
    try {
      await wishlistService.removeFromWishlist(
        req.user._id,
        req.params.productId
      );

      return res.status(200).json({
        success: true,
        message: "Product removed from wishlist.",
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // GET /wishlist/check/:productId
  // GET /wishlist/ids
  async wishlistIds(req, res) {
    try {
      const result = await wishlistService.wishlistIds(req.user._id);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  async checkWishlist(req, res) {
    try {
      const result = await wishlistService.checkWishlist(
        req.user._id,
        req.params.productId
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new WishlistController();