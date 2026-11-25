/**
 * Send one order's email now, with the email settings in .env, and show
 * exactly what happened. To check why a customer didn't get an email.
 *
 *   npm run email:order -- KRD-20261125-0001 cancelled
 *   npm run email:order -- KRD-20261125-0001 placed
 *   npm run email:order -- KRD-20261125-0001 cancelled you@gmail.com   (send to yourself instead)
 *
 * Kinds: placed, confirmed, cancelled (as cancelled by the customer).
 */
require("../config/bootstrap");
require("dotenv").config();

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const Order = require("../models/Order");
const User = require("../models/User");
const templates = require("../emails/templates");
const { sendOrderEmail } = require("../services/orderEmailService");
const { transportName } = require("../utils/mailer");

const KINDS = {
  placed: templates.orderPlacedEmail,
  confirmed: templates.orderConfirmedEmail,
  cancelled: templates.orderCancelledEmail,
};

async function main() {
  const [orderNumber, kind = "cancelled", sendTo = ""] = process.argv.slice(2);
  if (!orderNumber || !KINDS[kind]) {
    console.log("Usage: npm run email:order -- <order number> <placed|confirmed|cancelled> [send to this address instead]");
    process.exit(1);
  }
  await connectDatabase();
  const order = await Order.findOne({ orderNumber: orderNumber.trim().toUpperCase() });
  if (!order) throw new Error(`No order ${orderNumber}.`);
  const user = order.user ? await User.findById(order.user).lean() : null;

  console.log(`Order ${order.orderNumber}: ${order.orderStatus}, ${order.paymentMethod}`);
  console.log(`  email on the order:   ${order.contactEmail || "(none)"}`);
  console.log(`  email on the account: ${user?.email || user?.contactEmail || "(none)"}`);
  console.log(`  emails go out via:    ${transportName()}`);

  const target = sendTo ? Object.assign(order.toObject(), { contactEmail: sendTo }) : order;
  const ok = await sendOrderEmail(kind, KINDS[kind], target, order.user, {}, { throwErrors: true });
  console.log(ok ? "Sent. Check the inbox, and the spam folder." : "Not sent: see above (no address, or no email settings in .env).");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
