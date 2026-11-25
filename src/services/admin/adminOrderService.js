const mongoose = require("mongoose");

const Order = require("../../models/Order");
const HttpError = require("../../utils/httpError");
const paymentService = require("../paymentService");
const Courier = require("../../models/Courier");
const { sendOrderCancelled, sendOrderConfirmed, sendOrderStep, sendOrderMessage, recipientFor } = require("../orderEmailService");

/**
 * Orders in the admin dashboard.
 *
 * A COD order starts as PENDING; an online order starts as AWAITING_PAYMENT
 * and becomes PENDING once Cashfree confirms the payment. From there the
 * admin moves it along:
 *
 *   PENDING → CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
 *
 * Steps can be skipped forwards (e.g. PENDING → SHIPPED) but never go back.
 * CANCELLED is possible until delivery, RETURNED only after it. Cancelling or
 * returning a paid online order refunds it in full through Cashfree.
 */
const FLOW = ["PENDING", "CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];

const STATUS_NOTES = {
  CONFIRMED: "Order confirmed.",
  PACKED: "Order packed.",
  SHIPPED: "Order shipped.",
  OUT_FOR_DELIVERY: "Out for delivery.",
  DELIVERED: "Delivered.",
  CANCELLED: "Cancelled by Kreedum Sports.",
  RETURNED: "Returned.",
};

/** Real orders: not an online checkout that was never paid. */
const PLACED = {
  orderStatus: { $ne: "AWAITING_PAYMENT" },
  "payment.expired": { $ne: true },
};

/** Which statuses an order can be moved to from where it is now. */
function nextStatuses(order) {
  const current = order.orderStatus;
  if (current === "AWAITING_PAYMENT") return ["CANCELLED"];
  if (current === "DELIVERED") return ["RETURNED"];
  const at = FLOW.indexOf(current);
  if (at === -1) return []; // CANCELLED / RETURNED: final
  return [...FLOW.slice(at + 1), "CANCELLED"];
}

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function checkId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid order id.");
}

function listItem(order) {
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customer: order.shippingAddress?.fullName || "",
    phone: order.shippingAddress?.phone || "",
    city: order.shippingAddress?.city || "",
    itemCount: (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0),
    firstItem: order.items?.[0]?.name || "",
    thumbnail: order.items?.[0]?.thumbnail || "",
    total: order.pricing?.total || 0,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    isNew: !order.adminSeenAt && order.orderStatus !== "AWAITING_PAYMENT",
  };
}

class AdminOrderService {
  /**
   * Orders, newest first.
   * @param {{ status?: string, q?: string, payment?: string, page?: number, limit?: number }} filters
   *   status: an orderStatus, "NEW" (not opened yet), "ACTIVE" (still to deliver),
   *   "TO_SHIP" (confirmed or packed) or "IN_TRANSIT" (shipped or out for delivery)
   */
  async list({ status = "", q = "", payment = "", page = 1, limit = 25 } = {}) {
    const filter = {};
    if (status === "NEW") Object.assign(filter, PLACED, { adminSeenAt: null });
    else if (status === "ACTIVE") filter.orderStatus = { $in: FLOW.slice(0, -1) };
    else if (status === "TO_SHIP") filter.orderStatus = { $in: ["CONFIRMED", "PACKED"] };
    else if (status === "IN_TRANSIT") filter.orderStatus = { $in: ["SHIPPED", "OUT_FOR_DELIVERY"] };
    else if (status) filter.orderStatus = status;
    else Object.assign(filter, PLACED);

    if (payment) filter.paymentMethod = payment;

    const text = String(q || "").trim();
    if (text) {
      const pattern = new RegExp(escapeRegex(text), "i");
      filter.$or = [
        { orderNumber: pattern },
        { "shippingAddress.fullName": pattern },
        { "shippingAddress.phone": pattern },
        { contactEmail: pattern },
      ];
    }

    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((current - 1) * size).limit(size).lean(),
      Order.countDocuments(filter),
    ]);

    return { orders: orders.map(listItem), page: current, pages: Math.max(Math.ceil(total / size), 1), total };
  }

  /** One order with everything, marked as seen. */
  async get(orderId) {
    checkId(orderId);
    const order = await Order.findById(orderId).populate("user", "firstName lastName email phone createdAt").lean();
    if (!order) throw new HttpError(404, "Order not found.");

    if (!order.adminSeenAt && order.orderStatus !== "AWAITING_PAYMENT") {
      order.adminSeenAt = new Date();
      await Order.updateOne({ _id: order._id, adminSeenAt: null }, { $set: { adminSeenAt: order.adminSeenAt } });
    }
    const { to } = await recipientFor(order, order.user?._id || order.user).catch(() => ({ to: "" }));
    return { ...order, id: String(order._id), nextStatuses: nextStatuses(order), customerEmail: to || "" };
  }

  /**
   * Move an order to its next status (see FLOW at the top) and, unless
   * notify is false, email the customer. note: the message for the customer
   * (and the order history). Shipped: courier, trackingId, trackingUrl.
   */
  async updateStatus(orderId, { status, note = "", notify = true, courier = "", trackingId = "", trackingUrl = "" } = {}) {
    checkId(orderId);
    const order = await Order.findById(orderId);
    if (!order) throw new HttpError(404, "Order not found.");

    const target = String(status || "").toUpperCase();
    if (!nextStatuses(order).includes(target)) {
      throw new HttpError(400, `An order that is ${order.orderStatus} can't be marked ${target || "(empty)"}.`, "BAD_STATUS");
    }

    const message = String(note || "").trim().slice(0, 300);
    if (target === "SHIPPED") {
      const found = courier ? await Courier.findOne({ name: String(courier).trim() }).lean() : null;
      const id = String(trackingId || "").trim().slice(0, 80);
      let url = String(trackingUrl || "").trim().slice(0, 500);
      if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, "The tracking link must start with http:// or https://.");
      if (!url && id && found?.trackingUrl) url = found.trackingUrl.replace("{id}", encodeURIComponent(id));
      order.shipment = { courier: String(courier || "").trim().slice(0, 60), trackingId: id, trackingUrl: url, shippedAt: new Date() };
    }

    order.orderStatus = target;
    order.statusHistory.push({
      status: target,
      updatedAt: new Date(),
      note:
        message ||
        (target === "SHIPPED" && order.shipment?.courier
          ? `Shipped with ${order.shipment.courier}${order.shipment.trackingId ? ` (tracking ${order.shipment.trackingId})` : ""}.`
          : STATUS_NOTES[target]),
    });
    if (!order.adminSeenAt) order.adminSeenAt = new Date();

    // Cash on delivery: delivered means the money was collected.
    if (target === "DELIVERED" && order.paymentMethod === "COD" && order.paymentStatus === "PENDING") {
      order.paymentStatus = "PAID";
    }

    await order.save();

    if (target === "CANCELLED" || target === "RETURNED") {
      // Paid online: full refund through Cashfree (does nothing for COD).
      await paymentService.refundOrder(order);
    }
    // Email the customer, in the background (never affects the status change).
    if (notify !== false) {
      if (target === "CONFIRMED") sendOrderConfirmed(order, order.user, message);
      else if (target === "CANCELLED") sendOrderCancelled(order, order.user, { byStore: true, reason: message });
      else sendOrderStep(order, order.user, target, message);
    }

    return this.get(orderId);
  }

  /** Email the customer about an order: { subject, message }. */
  async emailCustomer(orderId, { subject = "", message = "" } = {}, admin) {
    checkId(orderId);
    const order = await Order.findById(orderId);
    if (!order) throw new HttpError(404, "Order not found.");
    const text = String(message).trim();
    if (text.length < 2) throw new HttpError(400, "Write a message.");
    if (text.length > 5000) throw new HttpError(400, "The message is too long (max 5,000 characters).");
    const title = String(subject).trim().slice(0, 150) || `About your order ${order.orderNumber}`;

    const sent = await sendOrderMessage(order, order.user, { subject: title, message: text });
    if (!sent) throw new HttpError(400, "This customer has no email address (on the order or their account).");
    order.customerEmails.push({
      subject: title,
      message: text,
      by: [admin?.firstName, admin?.lastName].filter(Boolean).join(" ") || admin?.email || "",
      at: new Date(),
    });
    await order.save();
    return this.get(orderId);
  }

  // ---------------------------------------------------------------- couriers

  /** Couriers to ship with (some common ones are added the first time). */
  async couriers() {
    if (!(await Courier.exists({}))) {
      const names = ["Delhivery", "Shiprocket", "Blue Dart", "DTDC", "Ekart", "Xpressbees", "India Post", "Shadowfax", "Porter", "Own delivery (Kreedum)"];
      await Courier.insertMany(names.map((name, i) => ({ name, displayOrder: (i + 1) * 10 })));
    }
    const list = await Courier.find({}).sort({ displayOrder: 1, name: 1 }).lean();
    return list.map((c) => ({ id: String(c._id), name: c.name, trackingUrl: c.trackingUrl || "", isActive: c.isActive !== false }));
  }

  #courierFields(body = {}) {
    const fields = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 60) throw new HttpError(400, "Courier name: 2 to 60 characters.");
      fields.name = name;
    }
    if (body.trackingUrl !== undefined) {
      const url = String(body.trackingUrl || "").trim();
      if (url && !/^https?:\/\/.+\{id\}/i.test(url)) {
        throw new HttpError(400, "Tracking link: a web address with {id} where the tracking number goes, e.g. https://example.com/track/{id}");
      }
      fields.trackingUrl = url;
    }
    if (body.isActive !== undefined) fields.isActive = Boolean(body.isActive);
    return fields;
  }

  async createCourier(body = {}) {
    const fields = this.#courierFields(body);
    if (!fields.name) throw new HttpError(400, "Give the courier a name.");
    if (await Courier.exists({ name: fields.name })) throw new HttpError(409, `"${fields.name}" is already in the list.`);
    const last = await Courier.findOne({}).sort({ displayOrder: -1 }).lean();
    await Courier.create({ ...fields, displayOrder: (last?.displayOrder || 0) + 10 });
    return this.couriers();
  }

  async updateCourier(id, body = {}) {
    checkId(id);
    const updated = await Courier.findByIdAndUpdate(id, { $set: this.#courierFields(body) }, { new: true });
    if (!updated) throw new HttpError(404, "Courier not found.");
    return this.couriers();
  }

  async deleteCourier(id) {
    checkId(id);
    await Courier.deleteOne({ _id: id });
    return this.couriers();
  }

  /**
   * For the dashboard's live alerts: every placed order nobody has opened
   * yet (newest first), and how many there are.
   */
  async feed() {
    const filter = { ...PLACED, adminSeenAt: null };
    const [orders, count] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(20).lean(),
      Order.countDocuments(filter),
    ]);
    return { count, orders: orders.map(listItem) };
  }

  /** "Mark all as seen". */
  async markAllSeen() {
    // Only placed orders: an online order still waiting for payment must
    // still show up as new once it's paid.
    const result = await Order.updateMany({ ...PLACED, adminSeenAt: null }, { $set: { adminSeenAt: new Date() } });
    return { updated: result.modifiedCount || 0 };
  }
}

module.exports = new AdminOrderService();
module.exports.nextStatuses = nextStatuses;
module.exports.FLOW = FLOW;
