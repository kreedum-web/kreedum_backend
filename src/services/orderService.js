const mongoose = require("mongoose");

const Cart = require("../models/Cart");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { findVariant, hasVariants, pricing } = require("../utils/productVariants");

const MAX_CART_QUANTITY = 5;

class OrderService {

  // ==================================================
  // Place Order (Cart → Order)
  // ==================================================

  async placeOrder(userId, payload) {

    const session = await mongoose.startSession();
    session.startTransaction();

    try {

      const cartItems = await Cart.find({ user: userId })
        .populate("product")
        .session(session);

      if (cartItems.length === 0) {
        throw new Error("Your cart is empty.");
      }

      const orderItems = [];
      let subtotal = 0;

      for (const cartItem of cartItems) {

        const product = cartItem.product;

        if (!product || !product.isActive || product.visibility !== "published") {
          throw new Error("One or more products are unavailable.");
        }

        if (cartItem.quantity > MAX_CART_QUANTITY) {
          throw new Error("Maximum quantity exceeded.");
        }

        // Products sold in several weights / sizes are charged at the
        // chosen option's price, never the product's "from" price.
        const variant = findVariant(product, cartItem.variantId);

        if (hasVariants(product) ? !variant : cartItem.variantId) {
          throw new Error(
            `Please choose an option again for ${product.name}: the one in your cart is no longer available.`
          );
        }

        if (variant && variant.inStock === false) {
          throw new Error(`${product.name} (${variant.label}) is out of stock.`);
        }

        const unit = pricing(product, variant);
        const price = unit.sellingPrice;
        const total = price * cartItem.quantity;

        subtotal += total;

        orderItems.push({
          product: product._id,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          thumbnail: unit.thumbnail,
          sku: unit.sku,
          variantId: variant ? variant.variantId : "",
          variantLabel: unit.variantLabel,
          price,
          mrp: unit.mrp,
          quantity: cartItem.quantity,
          total,
        });
      }

      const shippingCharge = subtotal >= 999 ? 0 : 99;
      const gst = 0;
      const discount = 0;

      const grandTotal =
        subtotal + shippingCharge + gst - discount;

      const order = await Order.create(
        [
          {
            user: userId,

            items: orderItems,

            shippingAddress: payload.shippingAddress,

            pricing: {
              subtotal,
              shippingCharge,
              discount,
              gst,
              total: grandTotal,
            },

            paymentMethod: payload.paymentMethod || "COD",

            paymentStatus:
              payload.paymentMethod === "COD"
                ? "PENDING"
                : "PENDING",

            orderStatus: "PENDING",

            notes: payload.notes || "",

            statusHistory: [
              {
                status: "PENDING",
                updatedAt: new Date(),
                note: "Order placed successfully.",
              },
            ],
          },
        ],
        { session }
      );

      await Cart.deleteMany({ user: userId }).session(session);

      await session.commitTransaction();
      session.endSession();

      return order[0];

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  // ==================================================
  // Get My Orders
  // ==================================================

  async getMyOrders(userId) {

    const orders = await Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return orders;
  }

  // ==================================================
  // Get Single Order
  // ==================================================

  async getOrderDetails(userId, orderId) {

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new Error("Invalid order ID.");
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
    }).lean();

    if (!order) {
      throw new Error("Order not found.");
    }

    return order;
  }

  // ==================================================
  // Cancel Order
  // ==================================================

  async cancelOrder(userId, orderId) {

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new Error("Invalid order ID.");
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
    });

    if (!order) {
      throw new Error("Order not found.");
    }

    if (
      order.orderStatus !== "PENDING" &&
      order.orderStatus !== "CONFIRMED"
    ) {
      throw new Error("Order cannot be cancelled.");
    }

    order.orderStatus = "CANCELLED";

    order.statusHistory.push({
      status: "CANCELLED",
      updatedAt: new Date(),
      note: "Cancelled by customer.",
    });

    await order.save();

    return order;
  }

  // ==================================================
  // Tracking Timeline
  // ==================================================

  async getTrackingTimeline(userId, orderId) {

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw new Error("Invalid order ID.");
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
    }).lean();

    if (!order) {
      throw new Error("Order not found.");
    }

    return {
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      timeline: order.statusHistory,
    };
  }

}

module.exports = new OrderService();