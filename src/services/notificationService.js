const Notification = require("../models/Notification");

/**
 * Admin dashboard alerts. Only the newest KEEP_LATEST are kept (and each is
 * deleted after 2 days anyway, see models/Notification.js), so the
 * collection never grows.
 */
const KEEP_LATEST = 20;

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Save an alert. Never throws and is never awaited by the caller's main
 * work: an alert failing must not break an order or an enquiry.
 */
function notify({ type, title, body = "", link = "" }) {
  return (async () => {
    await Notification.create({
      type,
      title: String(title).slice(0, 140),
      body: String(body || "").slice(0, 300),
      link,
    });
    // Drop anything older than the newest KEEP_LATEST.
    const keep = await Notification.find({}, { _id: 1 }).sort({ createdAt: -1, _id: -1 }).limit(KEEP_LATEST).lean();
    if (keep.length === KEEP_LATEST) {
      await Notification.deleteMany({ _id: { $nin: keep.map((n) => n._id) } });
    }
  })().catch((error) => console.error("Notification not saved:", error.message));
}

// ------------------------------------------------------------ the alerts

function newOrder(order) {
  const a = order.shippingAddress || {};
  const items = (order.items || []).reduce((sum, i) => sum + (i.quantity || 0), 0);
  return notify({
    type: "NEW_ORDER",
    title: `New order ${order.orderNumber}`,
    body: `${a.fullName || "A customer"}${a.city ? `, ${a.city}` : ""} · ${items} item${items === 1 ? "" : "s"} · ${rupees(order.pricing?.total)} · ${
      order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"
    }`,
    link: `/orders/${order._id}`,
  });
}

function orderCancelledByCustomer(order) {
  const paidOnline = order.paymentMethod === "ONLINE" && order.paymentStatus !== "PENDING";
  return notify({
    type: "ORDER_CANCELLED",
    title: `Order ${order.orderNumber} cancelled by the customer`,
    body: `${order.shippingAddress?.fullName || "Customer"} · ${rupees(order.pricing?.total)}${paidOnline ? " · refund started automatically" : ""}`,
    link: `/orders/${order._id}`,
  });
}

/** Any saved enquiry (models/Enquiry.js), by its kind. */
function newEnquiry(enquiry) {
  const who = enquiry.name || enquiry.accountLogin || "A website visitor";
  const where = enquiry.city ? `, ${enquiry.city}` : "";
  const byKind = {
    bulk: ["BULK_ENQUIRY", `Bulk enquiry from ${who}`, [enquiry.organisation, enquiry.equipmentNeed, enquiry.budget].filter(Boolean).join(" · ")],
    contact: ["CONTACT_ENQUIRY", `Contact form: ${who}${where}`, [enquiry.topic, enquiry.message].filter(Boolean).join(" · ")],
    product: ["PRODUCT_ENQUIRY", `${who} asked about a product on WhatsApp`, enquiry.productName || ""],
    whatsapp: [
      "WHATSAPP_ENQUIRY",
      `${who} opened a WhatsApp chat`,
      enquiry.orderNumber ? `About order ${enquiry.orderNumber}` : enquiry.productName ? `From ${enquiry.productName}` : enquiry.page ? `From ${enquiry.page}` : "",
    ],
  };
  const [type, title, body] = byKind[enquiry.kind] || byKind.bulk;
  return notify({ type, title, body, link: `/enquiries?kind=${enquiry.kind || "bulk"}` });
}

module.exports = { notify, newOrder, orderCancelledByCustomer, newEnquiry, KEEP_LATEST };
