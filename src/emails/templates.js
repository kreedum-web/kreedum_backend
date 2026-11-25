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

/**
 * After an order is placed. Not "confirmed" yet: the store checks the stock
 * first and confirms it in the admin (see orderConfirmedEmail).
 */
function orderPlacedEmail({ order, name }) {
  const items = order.items || [];
  const pricing = order.pricing || {};
  const address = order.shippingAddress || {};
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const payment =
    order.paymentMethod === "COD"
      ? "Cash on delivery"
      : order.paymentStatus === "PAID"
        ? `Paid online${order.payment?.method ? ` (${String(order.payment.method).replace(/_/g, " ")})` : ""}`
        : order.paymentMethod || "";

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
    subject: `Order placed — ${order.orderNumber}`,
    html: layout({
      preheader: `We've received your order ${order.orderNumber}. We'll confirm it shortly.`,
      body: `<p style="margin:0 0 8px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
<p style="margin:0 0 18px;">Thank you for shopping with Kreedum Sports! We've received your order. Our team is checking availability and will <strong>confirm it shortly</strong>: you'll get another email once it's confirmed.</p>
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
      `Thank you for your order ${order.orderNumber}! We've received it.`,
      "Our team is checking availability and will confirm it shortly: you'll get another email once it's confirmed.",
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

const button = (url, label) =>
  url
    ? `<p style="margin:22px 0 0;"><a href="${escape(url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:bold;">${label}</a></p>`
    : "";

/** The store checked the stock and confirmed the order (admin). */
function orderConfirmedEmail({ order, name, message = "" }) {
  const items = order.items || [];
  const pricing = order.pricing || {};
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const list = items
    .map(
      (item) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid #EEF1F7;">
  <div style="font-weight:bold;">${escape(item.name)}</div>
  ${item.variantLabel ? `<div style="font-size:13px;color:${MUTED};">${escape(item.variantLabel)}</div>` : ""}
</td>
<td style="padding:8px 0;border-bottom:1px solid #EEF1F7;text-align:right;color:${MUTED};white-space:nowrap;">× ${item.quantity}</td>
</tr>`
    )
    .join("");
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: layout({
      preheader: `Good news: your order ${order.orderNumber} is confirmed.`,
      body: `<p style="margin:0 0 8px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
<p style="margin:0 0 18px;">Good news! Your order <strong>${escape(order.orderNumber)}</strong> is <strong>confirmed</strong>: everything is available and we're getting it ready. We'll let you know when it's on its way.</p>
${message ? `<p style="margin:0 0 18px;padding:10px 14px;border-left:3px solid ${BLUE};background:#F6F8FC;">${escape(message)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;">${list}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:4px 0;font-weight:bold;">Order total</td><td style="padding:4px 0;text-align:right;font-weight:bold;">${inr(pricing.total)}</td></tr>
</table>
${button(orderUrl, "View your order")}`,
    }),
    text: [
      `${name ? `Hi ${name},` : "Hi,"}`,
      "",
      `Good news! Your order ${order.orderNumber} is confirmed: everything is available and we're getting it ready.`,
      "We'll let you know when it's on its way.",
      ...(message ? ["", message] : []),
      "",
      ...items.map((item) => `- ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} x ${item.quantity}`),
      "",
      `Order total: ${inr(pricing.total)}`,
      ...(orderUrl ? ["", `View your order: ${orderUrl}`] : []),
    ].join("\n"),
  };
}

// What each step tells the customer.
const STEP_TEXT = {
  PACKED: {
    subject: "Order packed",
    headline: "Your order is packed",
    text: "Your order is packed and ready to go. We'll let you know as soon as it's shipped.",
  },
  SHIPPED: {
    subject: "Order shipped",
    headline: "Your order is on its way",
    text: "Good news: your order has been shipped.",
  },
  OUT_FOR_DELIVERY: {
    subject: "Out for delivery",
    headline: "Your order is out for delivery",
    text: "Your order is out for delivery and should reach you today. Please keep your phone close: the delivery partner may call.",
  },
  DELIVERED: {
    subject: "Order delivered",
    headline: "Your order has been delivered",
    text: "Your order has been delivered. We hope you enjoy it! If anything isn't right, reply to this email or contact us.",
  },
  RETURNED: {
    subject: "Order returned",
    headline: "Your return is complete",
    text: "Your order has been marked as returned.",
  },
};

/**
 * Packed, shipped (courier, tracking number and link), out for delivery,
 * delivered, returned. message: the team's message, when it wrote one.
 */
function orderStepEmail({ order, name, status, message = "" }) {
  const step = STEP_TEXT[status];
  if (!step) throw new Error(`No email for status ${status}`);
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const ship = status === "SHIPPED" ? order.shipment || {} : {};
  const refunded = status === "RETURNED" && order.paymentMethod !== "COD" && order.paymentStatus !== "PENDING";
  const extra = refunded ? " Your payment is refunded to the same account or card (banks take 5–7 working days)." : "";

  const shipHtml =
    ship.courier || ship.trackingId
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 6px;background:#F6F8FC;border-radius:10px;">
<tr><td style="padding:12px 14px;">
${ship.courier ? `<div><span style="color:${MUTED};">Courier:</span> <strong>${escape(ship.courier)}</strong></div>` : ""}
${ship.trackingId ? `<div style="margin-top:4px;"><span style="color:${MUTED};">Tracking number:</span> <strong>${escape(ship.trackingId)}</strong></div>` : ""}
</td></tr></table>${ship.trackingUrl ? button(ship.trackingUrl, "Track your order") : ""}`
      : "";

  return {
    subject: `${step.subject} — ${order.orderNumber}`,
    html: layout({
      preheader: `${step.headline}: order ${order.orderNumber}.`,
      body: `<p style="margin:0 0 8px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
<p style="margin:0 0 6px;font-size:18px;font-weight:bold;">${escape(step.headline)}</p>
<p style="margin:0 0 14px;">${escape(step.text + extra)} <span style="color:${MUTED};">(Order ${escape(order.orderNumber)})</span></p>
${message ? `<p style="margin:0 0 14px;padding:10px 14px;border-left:3px solid ${BLUE};background:#F6F8FC;">${escape(message)}</p>` : ""}
${shipHtml}
${ship.trackingUrl ? "" : button(orderUrl, "View your order")}`,
    }),
    text: [
      `${name ? `Hi ${name},` : "Hi,"}`,
      "",
      `${step.headline} (order ${order.orderNumber}).`,
      step.text + extra,
      ...(message ? ["", message] : []),
      ...(ship.courier ? ["", `Courier: ${ship.courier}`] : []),
      ...(ship.trackingId ? [`Tracking number: ${ship.trackingId}`] : []),
      ...(ship.trackingUrl ? [`Track it: ${ship.trackingUrl}`] : []),
      ...(orderUrl ? ["", `View your order: ${orderUrl}`] : []),
    ].join("\n"),
  };
}

/** A message the team writes to the customer about an order (admin). */
function orderMessageEmail({ order, name, subject, message }) {
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const paragraphs = String(message)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return {
    subject,
    html: layout({
      preheader: `About your order ${order.orderNumber}`,
      body: `<p style="margin:0 0 12px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
${paragraphs}
<p style="margin:16px 0 0;color:${MUTED};font-size:14px;">About your order ${escape(order.orderNumber)}. Reply to this email to answer us.</p>
${button(orderUrl, "View your order")}`,
    }),
    text: [`${name ? `Hi ${name},` : "Hi,"}`, "", String(message), "", `About your order ${order.orderNumber}.`, ...(orderUrl ? [orderUrl] : [])].join("\n"),
  };
}

/**
 * An order was cancelled: by the customer, or by the store (byStore, e.g.
 * not available), with the store's reason when one was written.
 */
function orderCancelledEmail({ order, name, byStore = false, reason = "" }) {
  const items = order.items || [];
  const pricing = order.pricing || {};
  const orderUrl = siteUrl() ? `${siteUrl()}/account/orders/${order._id}` : "";
  const rows = items
    .map(
      (item) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid #EEF1F7;">
  <div style="font-weight:bold;">${escape(item.name)}</div>
  ${item.variantLabel ? `<div style="font-size:13px;color:${MUTED};">${escape(item.variantLabel)}</div>` : ""}
</td>
<td style="padding:8px 0;border-bottom:1px solid #EEF1F7;text-align:right;color:${MUTED};white-space:nowrap;">× ${item.quantity}</td>
</tr>`
    )
    .join("");
  // Paid online: the refund has been started (or is being sent) to the same account.
  const paid = ["PAID", "REFUND_INITIATED", "REFUNDED"].includes(order.paymentStatus);

  return {
    subject: `Order cancelled — ${order.orderNumber}`,
    html: layout({
      preheader: byStore ? `We're sorry: your order ${order.orderNumber} was cancelled.` : `Your order ${order.orderNumber} has been cancelled.`,
      body: `<p style="margin:0 0 8px;">${name ? `Hi ${escape(name)},` : "Hi,"}</p>
<p style="margin:0 0 18px;">${
        byStore
          ? `We're sorry: we had to cancel your order <strong>${escape(order.orderNumber)}</strong>.${reason ? ` Reason: ${escape(reason)}` : ""}`
          : `Your order <strong>${escape(order.orderNumber)}</strong> has been cancelled as you asked.`
      } ${
        paid
          ? "Your full payment is being refunded to the same account or card you paid with. Banks usually take 5–7 working days."
          : "Nothing was charged, so there's nothing to pay."
      }</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:4px 0;color:${MUTED};">Order total</td><td style="padding:4px 0;text-align:right;text-decoration:line-through;color:${MUTED};">${inr(pricing.total)}</td></tr>
</table>
<p style="margin:18px 0 0;color:${MUTED};font-size:14px;">${byStore ? "Questions, or want something similar?" : "Didn't cancel this?"} ${
        siteUrl() ? `<a href="${escape(`${siteUrl()}/contact`)}" style="color:${BLUE};">Contact us</a>` : "Contact us"
      } and we'll help.</p>
${orderUrl ? `<p style="margin:20px 0 0;"><a href="${escape(orderUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${BLUE};color:#ffffff;text-decoration:none;font-weight:bold;">View order</a></p>` : ""}`,
    }),
    text: [
      `${name ? `Hi ${name},` : "Hi,"}`,
      "",
      byStore
        ? `We're sorry: we had to cancel your order ${order.orderNumber}.${reason ? ` Reason: ${reason}` : ""}`
        : `Your order ${order.orderNumber} has been cancelled as you asked.`,
      paid ? "Your full payment is being refunded to the same account or card you paid with. Banks usually take 5-7 working days." : "Nothing was charged, so there's nothing to pay.",
      "",
      ...items.map((item) => `- ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} x ${item.quantity}`),
      "",
      `Order total (cancelled): ${inr(pricing.total)}`,
      ...(orderUrl ? ["", `View order: ${orderUrl}`] : []),
    ].join("\n"),
  };
}

module.exports = {
  orderPlacedEmail,
  orderConfirmedEmail,
  orderCancelledEmail,
  orderStepEmail,
  orderMessageEmail,
  // older name of orderPlacedEmail
  orderConfirmationEmail: orderPlacedEmail,
  loginCodeEmail,
  verificationCodeEmail,
  passwordResetCodeEmail,
  escape,
};
