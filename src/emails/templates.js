/**
 * Kreedum emails. Each template returns { subject, html, text }.
 * HTML uses tables and inline styles only, which is what email apps
 * (Gmail, Outlook, phones) display reliably.
 */
const NAVY = "#0E1A3D";
const BLUE = "#2C62E0";
const MUTED = "#64748B";

const siteUrl = () => (process.env.SITE_URL || "").replace(/\/+$/, "");

const escape = (value = "") =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

function layout({ preheader, body }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kreedum Sports</title></head>
<body style="margin:0;padding:0;background:#F6F8FC;font-family:Arial,Helvetica,sans-serif;color:${NAVY};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="background:${NAVY};padding:18px 24px;font-size:20px;font-weight:bold;color:#ffffff;">Kreedum<span style="color:#7FA3FF;">Sports</span></td></tr>
<tr><td style="padding:28px 24px;font-size:15px;line-height:1.55;">${body}</td></tr>
<tr><td style="padding:16px 24px;background:#F1F4FA;font-size:12px;color:${MUTED};">Kreedum Sports, Lucknow · This is an automatic email, please don't reply to it.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function codeBlock(code) {
  return `<div style="margin:20px 0;text-align:center;">
<span style="display:inline-block;padding:14px 22px;border-radius:12px;background:#EAF0FF;color:${BLUE};font-size:30px;font-weight:bold;letter-spacing:8px;">${escape(code)}</span>
</div>`;
}

/** Sign-up: confirm the email address. */
function verificationCodeEmail({ name, code, minutes = 10 }) {
  const hello = name ? `Hi ${escape(name)},` : "Hi,";
  return {
    subject: `${code} is your Kreedum Sports verification code`,
    html: layout({
      preheader: `Your code is ${code}. It expires in ${minutes} minutes.`,
      body: `<p style="margin:0 0 8px;">${hello}</p>
<p style="margin:0;">Welcome to Kreedum Sports! Enter this code to confirm your email address:</p>
${codeBlock(code)}
<p style="margin:0;color:${MUTED};font-size:13px;">The code expires in ${minutes} minutes. If you didn't create an account, you can ignore this email.</p>`,
    }),
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nWelcome to Kreedum Sports! Your verification code is: ${code}\n\nIt expires in ${minutes} minutes. If you didn't create an account, ignore this email.`,
  };
}

/** Sign in / create account with a code (no password). */
function loginCodeEmail({ name, code, minutes = 10 }) {
  const hello = name ? `Hi ${escape(name)},` : "Hi,";
  return {
    subject: `${code} is your Kreedum Sports sign-in code`,
    html: layout({
      preheader: `Your sign-in code is ${code}. It expires in ${minutes} minutes.`,
      body: `<p style="margin:0 0 8px;">${hello}</p>
<p style="margin:0;">Enter this code on Kreedum Sports to sign in:</p>
${codeBlock(code)}
<p style="margin:0;color:${MUTED};font-size:13px;">The code expires in ${minutes} minutes. If you didn't try to sign in, you can ignore this email.</p>`,
    }),
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nYour Kreedum Sports sign-in code is: ${code}\n\nIt expires in ${minutes} minutes. If you didn't try to sign in, ignore this email.`,
  };
}

/** Forgot password: code to set a new password. */
function passwordResetCodeEmail({ name, code, minutes = 10 }) {
  const hello = name ? `Hi ${escape(name)},` : "Hi,";
  return {
    subject: `${code} is your Kreedum Sports password reset code`,
    html: layout({
      preheader: `Your password reset code is ${code}.`,
      body: `<p style="margin:0 0 8px;">${hello}</p>
<p style="margin:0;">We received a request to reset your Kreedum Sports password. Enter this code to choose a new one:</p>
${codeBlock(code)}
<p style="margin:0;color:${MUTED};font-size:13px;">The code expires in ${minutes} minutes. If you didn't ask to reset your password, ignore this email — your password stays the same.</p>`,
    }),
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nYour Kreedum Sports password reset code is: ${code}\n\nIt expires in ${minutes} minutes. If you didn't ask for this, ignore this email.`,
  };
}

/** After an order is placed. */
function orderConfirmationEmail({ order, name }) {
  const items = order.items || [];
  const pricing = order.pricing || {};
  const address = order.shippingAddress || {};
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const payment = order.paymentMethod === "COD" ? "Cash on delivery" : order.paymentMethod || "";

  const rows = items
    .map(
      (item) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #EEF1F7;vertical-align:top;">
  <div style="font-weight:bold;">${escape(item.name)}</div>
  ${item.variantLabel ? `<div style="font-size:13px;color:${MUTED};">${escape(item.variantLabel)}</div>` : ""}
  <div style="font-size:13px;color:${MUTED};">${inr(item.price)} × ${item.quantity}</div>
</td>
<td style="padding:10px 0;border-bottom:1px solid #EEF1F7;text-align:right;vertical-align:top;font-weight:bold;white-space:nowrap;">${inr(item.total)}</td>
</tr>`
    )
    .join("");

  const line = (label, value, bold = false) => `<tr>
<td style="padding:4px 0;${bold ? "font-weight:bold;font-size:16px;" : `color:${MUTED};`}">${label}</td>
<td style="padding:4px 0;text-align:right;${bold ? "font-weight:bold;font-size:16px;" : ""}">${value}</td>
</tr>`;

  const addressText = [
    address.fullName,
    address.addressLine1,
    address.addressLine2,
    [address.locality, address.city].filter(Boolean).join(", "),
    [address.state, address.pincode].filter(Boolean).join(" "),
    address.phone ? `Phone: ${address.phone}` : "",
  ].filter(Boolean);

  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: layout({
      preheader: `Thank you for your order ${order.orderNumber}. Total ${inr(pricing.total)}.`,
      body: `<p style="margin:0 0 8px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
<p style="margin:0 0 18px;">Thank you for shopping with Kreedum Sports! We've received your order and will contact you about delivery.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
<tr><td style="color:${MUTED};font-size:13px;">Order number</td><td style="text-align:right;font-weight:bold;">${escape(order.orderNumber)}</td></tr>
${payment ? `<tr><td style="color:${MUTED};font-size:13px;">Payment</td><td style="text-align:right;">${escape(payment)}</td></tr>` : ""}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${line("Subtotal", inr(pricing.subtotal))}
${line("Shipping", pricing.shippingCharge ? inr(pricing.shippingCharge) : "Free")}
${pricing.discount ? line("Discount", `−${inr(pricing.discount)}`) : ""}
${line("Total", inr(pricing.total), true)}
</table>
<p style="margin:20px 0 4px;font-weight:bold;">Delivery address</p>
<p style="margin:0;color:${MUTED};font-size:14px;">${addressText.map(escape).join("<br>")}</p>
${orderUrl ? `<p style="margin:24px 0 0;"><a href="${escape(orderUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:bold;">View your order</a></p>` : ""}`,
    }),
    text: [
      `${name ? `Hi ${name},` : "Hi,"}`,
      "",
      `Thank you for your order ${order.orderNumber}!`,
      "",
      ...items.map((item) => `- ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}: ${inr(item.price)} x ${item.quantity} = ${inr(item.total)}`),
      "",
      `Subtotal: ${inr(pricing.subtotal)}`,
      `Shipping: ${pricing.shippingCharge ? inr(pricing.shippingCharge) : "Free"}`,
      ...(pricing.discount ? [`Discount: -${inr(pricing.discount)}`] : []),
      `Total: ${inr(pricing.total)}`,
      ...(payment ? [`Payment: ${payment}`] : []),
      "",
      "Delivery address:",
      ...addressText,
      ...(orderUrl ? ["", `View your order: ${orderUrl}`] : []),
    ].join("\n"),
  };
}

module.exports = { loginCodeEmail, verificationCodeEmail, passwordResetCodeEmail, orderConfirmationEmail, escape };
