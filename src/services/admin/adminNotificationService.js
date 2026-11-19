const mongoose = require("mongoose");
const Notification = require("../../models/Notification");
const Order = require("../../models/Order");
const { KEEP_LATEST } = require("../notificationService");

/** The dashboard's bell and Notifications page. */
class AdminNotificationService {
  /** Newest notifications (max 20, last 2 days), unread count, and orders not opened yet. */
  async list() {
    const [rows, unread, newOrders] = await Promise.all([
      Notification.find({}).sort({ createdAt: -1, _id: -1 }).limit(KEEP_LATEST).lean(),
      Notification.countDocuments({ readAt: null }),
      Order.countDocuments({ orderStatus: { $ne: "AWAITING_PAYMENT" }, "payment.expired": { $ne: true }, adminSeenAt: null }),
    ]);
    return {
      unread,
      newOrders,
      notifications: rows.map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      })),
    };
  }

  /** Mark one (id) or all (no id) as read. */
  async markRead(id) {
    if (id && !mongoose.Types.ObjectId.isValid(id)) return this.list();
    const filter = id ? { _id: id, readAt: null } : { readAt: null };
    await Notification.updateMany(filter, { $set: { readAt: new Date() } });
    return this.list();
  }

  /** "Clear all". */
  async clear() {
    await Notification.deleteMany({});
    return this.list();
  }
}

module.exports = new AdminNotificationService();
