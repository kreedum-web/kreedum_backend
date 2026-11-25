const User = require("../models/User");
const { sendMail } = require("../utils/mailer");
const { orderPlacedEmail, orderConfirmedEmail, orderCancelledEmail } = require("../emails/templates");

/**
 * Order emails go to the address saved on the order (contactEmail); older
 * orders don't have one, so fall back to the account's email.
 */
async function recipientFor(order, userId) {
  const user = await User.findById(userId).lean();
  const to = order.contactEmail || user?.email || user?.contactEmail || "";
  return { to, name: user?.firstName || order.shippingAddress?.fullName?.split(/\s+/)[0] || "" };
}

/**
 * Send one order email. Never throws: an email problem must not undo or
 * block an order action that already happened.
 * @returns {Promise<boolean>} whether it was handed to the mail service
 */
async function sendOrderEmail(kind, template, order, userId, extra = {}) {
  try {
    const plain = typeof order.toObject === "function" ? order.toObject() : order;
    const { to, name } = await recipientFor(plain, userId);
    if (!to) {
      console.warn(`Order ${kind} email not sent (${order?.orderNumber}): no email address on the order or account.`);
      return false;
    }
    const result = await sendMail({ to, ...template({ order: plain, name, ...extra }) });
    return Boolean(result?.sent);
  } catch (error) {
    console.error(`Order ${kind} email failed (${order?.orderNumber}):`, error.message);
    return false;
  }
}

/** Order placed (the store confirms it later). */
const sendOrderPlaced = (order, userId) => sendOrderEmail("placed", orderPlacedEmail, order, userId);
/** The store confirmed the order (admin). */
const sendOrderConfirmed = (order, userId) => sendOrderEmail("confirmed", orderConfirmedEmail, order, userId);
/** Cancelled; { byStore: true, reason } when the store cancelled it. */
const sendOrderCancelled = (order, userId, { byStore = false, reason = "" } = {}) =>
  sendOrderEmail("cancellation", orderCancelledEmail, order, userId, { byStore, reason });

module.exports = {
  sendOrderPlaced,
  sendOrderConfirmed,
  sendOrderCancelled,
  // older name of sendOrderPlaced
  sendOrderConfirmation: sendOrderPlaced,
};
