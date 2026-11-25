/**
 * Online payment (Cashfree) for orders placed with paymentMethod "ONLINE".
 *
 *   1. Checkout places the order → orderStatus AWAITING_PAYMENT, cart kept.
 *   2. startPayment → a Cashfree payment session; the website opens
 *      Cashfree's checkout (UPI, cards, netbanking…).
 *   3. Cashfree sends the customer back to /payment/return and also calls
 *      our webhook. Both end in confirmPayment, which asks Cashfree for the
 *      payments and, if one succeeded for the full amount, marks the order
 *      paid (once), empties the cart and emails the confirmation.
 *   4. Not paid within PAYMENT_WINDOW_MINUTES → the order cancels itself.
 *   5. A paid order cancelled by the customer is refunded automatically.
 */
const notifications = require("./notificationService");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const HttpError = require("../utils/httpError");
const cashfree = require("../utils/cashfree");
const { sendOrderPlaced } = require("./orderEmailService");
const { fillProfileFromAddress } = require("./profileFillService");

const PAYMENT_WINDOW_MINUTES = 60;

const siteUrl = () => (process.env.SITE_URL || "").replace(/\/+$/, "");
const apiUrl = () => (process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");

function requireConfig() {
  const config = cashfree.cashfreeConfig();
  if (!config) throw new HttpError(503, "Online payment isn't available right now. Please choose cash on delivery.", "PAYMENTS_OFF");
  return config;
}

async function findOwnOrder(userId, orderId) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw new HttpError(400, "Invalid order ID.", "INVALID_ORDER");
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw new HttpError(404, "Order not found.", "ORDER_NOT_FOUND");
  return order;
}

const deadlineOf = (order) => new Date(new Date(order.createdAt || Date.now()).getTime() + PAYMENT_WINDOW_MINUTES * 60 * 1000);

/** What the website needs to know about an order's payment. */
function paymentView(order) {
  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    amount: order.pricing?.total,
    payBefore: order.orderStatus === "AWAITING_PAYMENT" ? deadlineOf(order) : null,
    lastFailure: order.payment?.lastFailure || "",
    refundStatus: order.payment?.refundStatus || "",
  };
}

// ---------------------------------------------------------------- 1. options

function options() {
  const config = cashfree.cashfreeConfig();
  return { online: Boolean(config), mode: config?.mode || null, payWithinMinutes: PAYMENT_WINDOW_MINUTES };
}

// ---------------------------------------------------------------- 2. start

async function startPayment(userId, orderId) {
  const config = requireConfig();
  await expireUnpaidOrders({ userId });
  const order = await findOwnOrder(userId, orderId);

  if (order.paymentMethod !== "ONLINE") throw new HttpError(400, "This order is cash on delivery.", "NOT_ONLINE");
  if (order.paymentStatus === "PAID") throw new HttpError(409, "This order is already paid.", "ALREADY_PAID");
  if (order.orderStatus !== "AWAITING_PAYMENT") {
    throw new HttpError(409, "This order can't be paid any more. Please place a new order.", "PAYMENT_CLOSED");
  }

  // A session that is still valid for a few minutes is reused (Cashfree
  // allows several attempts on one payment order until it's paid).
  const stillValid = order.payment?.sessionId && order.payment.sessionExpiresAt && order.payment.sessionExpiresAt > new Date(Date.now() + 5 * 60 * 1000);
  if (stillValid) return { paymentSessionId: order.payment.sessionId, mode: config.mode, ...paymentView(order) };

  const address = order.shippingAddress || {};
  const attempt = order.payment?.gatewayOrderId ? Number(order.payment.gatewayOrderId.split("-R")[1] || 1) + 1 : 1;
  const gatewayOrderId = attempt === 1 ? order.orderNumber : `${order.orderNumber}-R${attempt}`;
  // Cashfree needs at least 15 minutes; give the customer the rest of the hour (min 20 min).
  const expiresAt = new Date(Math.max(deadlineOf(order).getTime(), Date.now() + 20 * 60 * 1000));

  const created = await cashfree.createOrder({
    gatewayOrderId,
    amount: order.pricing.total,
    customer: {
      customer_id: cashfree.customerId(userId),
      customer_phone: String(address.phone || "").replace(/\D/g, "").slice(-10),
      ...(order.contactEmail ? { customer_email: order.contactEmail } : {}),
      ...(address.fullName ? { customer_name: address.fullName } : {}),
    },
    returnUrl: `${siteUrl()}/payment/return?order=${order._id}`,
    // Webhooks need a public https address; they can also be set in the Cashfree dashboard.
    notifyUrl: apiUrl().startsWith("https://") ? `${apiUrl()}/api/v1/payments/cashfree/webhook` : "",
    expiresAt,
    note: `Kreedum Sports order ${order.orderNumber}`,
  });

  order.payment = {
    ...(order.payment?.toObject ? order.payment.toObject() : order.payment || {}),
    gateway: "cashfree",
    gatewayOrderId,
    sessionId: created.payment_session_id,
    sessionExpiresAt: created.order_expiry_time ? new Date(created.order_expiry_time) : expiresAt,
  };
  await order.save();

  return { paymentSessionId: created.payment_session_id, mode: config.mode, ...paymentView(order) };
}

// ---------------------------------------------------------------- 3. confirm

/**
 * Ask Cashfree what happened and update the order. Safe to call any number
 * of times, from the return page and the webhook at once: the order is
 * marked paid (and the email sent) exactly once.
 */
async function confirmPayment(order) {
  if (!order.payment?.gatewayOrderId || order.paymentStatus === "PAID") return order;

  const payments = await cashfree.getPayments(order.payment.gatewayOrderId);
  const list = Array.isArray(payments) ? payments : [];
  const total = Number(order.pricing.total);
  const success = list.find(
    (p) => p.payment_status === "SUCCESS" && Math.abs(Number(p.payment_amount ?? p.order_amount) - total) < 0.01
  );

  if (success) return markPaid(order, success);

  const latest = list.sort((a, b) => new Date(b.payment_time || 0) - new Date(a.payment_time || 0))[0];
  if (latest && ["FAILED", "USER_DROPPED", "CANCELLED"].includes(latest.payment_status)) {
    const reason =
      latest.payment_status === "USER_DROPPED"
        ? "Payment was not completed."
        : latest.payment_message || latest.error_details?.error_description || "Payment failed.";
    await Order.updateOne({ _id: order._id, paymentStatus: { $ne: "PAID" } }, { $set: { "payment.lastFailure": reason } });
    order.payment.lastFailure = reason;
  }
  return order;
}

async function markPaid(order, payment) {
  const now = new Date();
  // Only the first caller changes it; a payment that arrives just after the
  // hour (order already auto-cancelled) still revives the order.
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: { $ne: "PAID" },
      $or: [{ orderStatus: "AWAITING_PAYMENT" }, { orderStatus: "CANCELLED", "payment.expired": true }],
    },
    {
      $set: {
        paymentStatus: "PAID",
        orderStatus: "PENDING",
        "payment.paymentId": String(payment.cf_payment_id || ""),
        "payment.method": payment.payment_group || "",
        "payment.paidAt": payment.payment_completion_time ? new Date(payment.payment_completion_time) : now,
        "payment.lastFailure": "",
        "payment.expired": false,
      },
      $push: { statusHistory: { status: "PENDING", updatedAt: now, note: "Payment received. Order placed." } },
    },
    { new: true }
  );

  if (!updated) return (await Order.findById(order._id)) || order;

  // First time only: the order is real now.
  await Cart.deleteMany({ user: updated.user });
  fillProfileFromAddress(updated.user, updated.shippingAddress).then(() => sendOrderPlaced(updated, updated.user));
  notifications.newOrder(updated);
  return updated;
}

/** Return page: "did my payment go through?" */
async function paymentStatus(userId, orderId) {
  if (cashfree.cashfreeConfig()) await expireUnpaidOrders({ userId });
  let order = await findOwnOrder(userId, orderId);
  if (order.paymentMethod === "ONLINE" && cashfree.cashfreeConfig()) {
    try {
      order = await confirmPayment(order);
    } catch (error) {
      console.error(`Payment check failed for ${order.orderNumber}:`, error.message);
    }
  }
  return paymentView(order);
}

// ---------------------------------------------------------------- webhook

/**
 * Cashfree calls this after every payment attempt and refund.
 * @returns {Promise<boolean>} false when the signature is wrong
 */
async function handleWebhook(rawBody, headers) {
  const timestamp = headers["x-webhook-timestamp"];
  const signature = headers["x-webhook-signature"];
  if (!cashfree.verifyWebhook(rawBody, timestamp, signature)) return false;

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const gatewayOrderId = event?.data?.order?.order_id || event?.data?.refund?.order_id;
  if (!gatewayOrderId) return true;

  const order = await Order.findOne({ "payment.gatewayOrderId": gatewayOrderId });
  if (!order) return true; // not ours (or a test from the dashboard)

  if (String(event.type).startsWith("PAYMENT_")) {
    // Don't trust the message alone for the amount: ask Cashfree.
    await confirmPayment(order);
  } else if (String(event.type).startsWith("REFUND_")) {
    const refund = event.data.refund || {};
    if (refund.refund_status === "SUCCESS") {
      await Order.updateOne(
        { _id: order._id },
        { $set: { paymentStatus: "REFUNDED", "payment.refundStatus": "SUCCESS", "payment.refundedAt": new Date() } }
      );
    } else if (refund.refund_status) {
      await Order.updateOne({ _id: order._id }, { $set: { "payment.refundStatus": refund.refund_status } });
    }
  }
  return true;
}

// ---------------------------------------------------------------- 4. expire

/** Online orders not paid within the hour are cancelled (cart stays, so the customer can try again). */
async function expireUnpaidOrders({ userId } = {}) {
  const cutoff = new Date(Date.now() - PAYMENT_WINDOW_MINUTES * 60 * 1000);
  const now = new Date();
  const result = await Order.updateMany(
    { orderStatus: "AWAITING_PAYMENT", createdAt: { $lt: cutoff }, ...(userId ? { user: userId } : {}) },
    {
      $set: { orderStatus: "CANCELLED", "payment.expired": true },
      $push: { statusHistory: { status: "CANCELLED", updatedAt: now, note: "Payment not completed within an hour." } },
    }
  );
  return result?.modifiedCount || 0;
}

// ---------------------------------------------------------------- 5. refund

/** Full refund of a paid online order (after the customer cancelled it). Never throws. */
async function refundOrder(order) {
  if (order.paymentMethod !== "ONLINE" || order.paymentStatus !== "PAID" || !order.payment?.gatewayOrderId) return order;
  const refundId = `${order.orderNumber}-refund`;
  try {
    const refund = await cashfree.createRefund(order.payment.gatewayOrderId, {
      refundId,
      amount: order.pricing.total,
      note: "Order cancelled",
    });
    const done = refund.refund_status === "SUCCESS";
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          paymentStatus: done ? "REFUNDED" : "REFUND_INITIATED",
          "payment.refundId": refundId,
          "payment.refundStatus": refund.refund_status || "PENDING",
          ...(done ? { "payment.refundedAt": new Date() } : {}),
        },
      }
    );
    order.paymentStatus = done ? "REFUNDED" : "REFUND_INITIATED";
  } catch (error) {
    // Money isn't lost: it can be refunded from the Cashfree dashboard.
    console.error(`⚠️ Refund failed for ${order.orderNumber}: ${error.message}. Refund it from the Cashfree dashboard.`);
    await Order.updateOne({ _id: order._id }, { $set: { "payment.refundId": refundId, "payment.refundStatus": "NOT_STARTED" } });
  }
  return order;
}

module.exports = {
  PAYMENT_WINDOW_MINUTES,
  options,
  startPayment,
  confirmPayment,
  paymentStatus,
  handleWebhook,
  expireUnpaidOrders,
  refundOrder,
  paymentView,
};
