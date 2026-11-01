const User = require("../models/User");
const { sendMail } = require("../utils/mailer");
const { orderConfirmationEmail } = require("../emails/templates");

/**
 * Email the customer their order summary. Never throws: an email problem
 * must not undo or block an order that's already placed.
 * @returns {Promise<boolean>} whether it was handed to the mail service
 */
async function sendOrderConfirmation(order, userId) {
  try {
    const user = await User.findById(userId).lean();
    if (!user?.email) return false;

    const plain = typeof order.toObject === "function" ? order.toObject() : order;
    const result = await sendMail({ to: user.email, ...orderConfirmationEmail({ order: plain, name: user.firstName }) });
    return Boolean(result?.sent);
  } catch (error) {
    console.error(`Order confirmation email failed (${order?.orderNumber}):`, error.message);
    return false;
  }
}

module.exports = { sendOrderConfirmation };
