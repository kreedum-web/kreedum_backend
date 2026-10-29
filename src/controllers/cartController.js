const cartService = require("../services/cartService");

// Chosen option (weight, size …) of the cart line: body for add / update,
// ?variant= for remove (DELETE requests usually have no body).
const variantOf = (req) => String(req.body?.variantId ?? req.query?.variant ?? "");

class CartController {

  // GET /cart
  async getCart(req, res) {
    try {
      const cart = await cartService.getCart(req.user._id);

      return res.status(200).json({
        success: true,
        message: "Cart fetched successfully.",
        data: cart,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // POST /cart/:productId
  async addToCart(req, res) {
    try {
      const { quantity = 1 } = req.body;

      const cartItem = await cartService.addToCart(
        req.user._id,
        req.params.productId,
        Number(quantity),
        variantOf(req)
      );

      return res.status(201).json({
        success: true,
        message: "Product added to cart.",
        data: cartItem,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // PATCH /cart/:productId
  async updateQuantity(req, res) {
    try {
      const { quantity } = req.body;

      const cartItem = await cartService.updateQuantity(
        req.user._id,
        req.params.productId,
        Number(quantity),
        variantOf(req)
      );

      return res.status(200).json({
        success: true,
        message: "Cart quantity updated.",
        data: cartItem,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // DELETE /cart/:productId
  async removeFromCart(req, res) {
    try {
      await cartService.removeFromCart(
        req.user._id,
        req.params.productId,
        variantOf(req)
      );

      return res.status(200).json({
        success: true,
        message: "Product removed from cart.",
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // DELETE /cart
  async clearCart(req, res) {
    try {
      await cartService.clearCart(req.user._id);

      return res.status(200).json({
        success: true,
        message: "Cart cleared successfully.",
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new CartController();