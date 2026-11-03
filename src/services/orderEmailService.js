const User = require("../models/User");
const { sendMail } = require("../utils/mailer");
const { orderConfirmationEmail, orderCancelledEmail } = require("../emails/templates");

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
async function sendOrderEmail(kind, template, order, userId) {
  try {
    const plain = typeof order.toObject === "function" ? order.toObject() : order;
    const { to, name } = await recipientFor(plain, userId);
    if (!to) return false;
    const result = await sendMail({ to, ...template({ order: plain, name }) });
    return Boolean(result?.sent);
  } catch (error) {
    console.error(`Order ${kind} email failed (${order?.orderNumber}):`, error.message);
    return false;
  }
}

const sendOrderConfirmation = (order, userId) => sendOrderEmail("confirmation", orderConfirmationEmail, order, userId);
const sendOrderCancelled = (order, userId) => sendOrderEmail("cancellation", orderCancelledEmail, order, userId);

module.exports = { sendOrderConfirmation, sendOrderCancelled };
