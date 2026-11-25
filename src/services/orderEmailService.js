const User = require("../models/User");
const { sendMail } = require("../utils/mailer");
const { orderPlacedEmail, orderConfirmedEmail, orderCancelledEmail, orderStepEmail, orderMessageEmail } = require("../emails/templates");

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
async function sendOrderEmail(kind, template, order, userId, extra = {}, { throwErrors = false } = {}) {
  try {
    const plain = typeof order.toObject === "function" ? order.toObject() : order;
    const { to, name } = await recipientFor(plain, userId);
    if (!to) {
      console.warn(`Order ${kind} email not sent (${order?.orderNumber}): no email address on the order or account.`);
      return false;
    }
    const result = await sendMail({ to, ...template({ order: plain, name, ...extra }) });
    // One line per email in the server log (Render → Logs), to check what went out.
    if (result?.sent) console.log(`Order ${kind} email sent (${order?.orderNumber}) to ${to} via ${result.via}.`);
    return Boolean(result?.sent);
  } catch (error) {
    console.error(`Order ${kind} email failed (${order?.orderNumber}):`, error.message);
    if (throwErrors) throw error;
    return false;
  }
}

/** Order placed (the store confirms it later). */
const sendOrderPlaced = (order, userId) => sendOrderEmail("placed", orderPlacedEmail, order, userId);
/** The store confirmed the order (admin). */
const sendOrderConfirmed = (order, userId, message = "") =>
  sendOrderEmail("confirmed", orderConfirmedEmail, order, userId, { message });
/** Cancelled; { byStore: true, reason } when the store cancelled it. */
const sendOrderCancelled = (order, userId, { byStore = false, reason = "" } = {}) =>
  sendOrderEmail("cancellation", orderCancelledEmail, order, userId, { byStore, reason });

/** Packed / shipped / out for delivery / delivered / returned, with the team's message. */
const sendOrderStep = (order, userId, status, message = "") =>
  sendOrderEmail(status.toLowerCase(), orderStepEmail, order, userId, { status, message });
/** A message written in the admin (throws, so the admin sees why it failed). */
const sendOrderMessage = (order, userId, { subject, message }) =>
  sendOrderEmail("message", orderMessageEmail, order, userId, { subject, message }, { throwErrors: true });

module.exports = {
  sendOrderEmail,
  sendOrderStep,
  sendOrderMessage,
  recipientFor,
  sendOrderPlaced,
  sendOrderConfirmed,
  sendOrderCancelled,
  // older name of sendOrderPlaced
  sendOrderConfirmation: sendOrderPlaced,
};
