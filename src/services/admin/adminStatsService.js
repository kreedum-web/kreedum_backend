const mongoose = require("mongoose");

const Order = require("../../models/Order");
const User = require("../../models/User");
const Enquiry = require("../../models/Enquiry");
const Product = require("../../models/Product");
const PageView = require("../../models/PageView");
const HttpError = require("../../utils/httpError");
const { indiaDay, indiaDayStart } = require("../trackingService");

/** Orders that count as sales: placed (paid if online), not cancelled or returned. */
const SALES = {
  orderStatus: { $nin: ["AWAITING_PAYMENT", "CANCELLED", "RETURNED"] },
};
const PLACED = { orderStatus: { $ne: "AWAITING_PAYMENT" }, "payment.expired": { $ne: true } };

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const IST = "+05:30";

/** The last `days` India dates, oldest first: ["2026-10-20", …, "2026-11-18"]. */
function lastDays(days, now = new Date()) {
  return Array.from({ length: days }, (_, i) => indiaDay(new Date(now.getTime() - (days - 1 - i) * 86400000)));
}

const fillDays = (days, rows, pick) => {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  return days.map((day) => ({ day, ...pick(byDay.get(day)) }));
};

class AdminStatsService {
  /** Home page of the dashboard. */
  async overview(now = new Date()) {
    const today = indiaDay(now);
    const todayStart = indiaDayStart(today);
    const days = lastDays(30, now);
    const from = indiaDayStart(days[0]);
    const liveSince = new Date(now.getTime() - 5 * 60 * 1000);

    const [
      todaySales, monthSales, salesByDay, statusCounts, newOrders, recentOrders,
      newEnquiries, customersTotal, customersToday, visitorsToday, viewsToday, liveVisitors, outOfStock,
    ] = await Promise.all([
      Order.aggregate([{ $match: { ...SALES, createdAt: { $gte: todayStart } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$pricing.total" } } }]),
      Order.aggregate([{ $match: { ...SALES, createdAt: { $gte: from } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$pricing.total" } } }]),
      Order.aggregate([
        { $match: { ...SALES, createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: IST } }, orders: { $sum: 1 }, revenue: { $sum: "$pricing.total" } } },
      ]),
      Order.aggregate([{ $match: PLACED }, { $group: { _id: "$orderStatus", count: { $sum: 1 } } }]),
      Order.countDocuments({ ...PLACED, adminSeenAt: null }),
      Order.find(PLACED).sort({ createdAt: -1 }).limit(8).lean(),
      Enquiry.countDocuments({ status: "NEW" }),
      User.countDocuments({ role: { $ne: "admin" } }),
      User.countDocuments({ role: { $ne: "admin" }, createdAt: { $gte: todayStart } }),
      PageView.distinct("visitorId", { day: today }).then((ids) => ids.length),
      PageView.countDocuments({ day: today }),
      PageView.distinct("visitorId", { at: { $gte: liveSince } }).then((ids) => ids.length),
      Product.countDocuments({ isActive: true, visibility: "published", stockStatus: "out_of_stock" }),
    ]);

    const statuses = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    return {
      today: {
        orders: todaySales[0]?.orders || 0,
        revenue: todaySales[0]?.revenue || 0,
        visitors: visitorsToday,
        pageViews: viewsToday,
        newCustomers: customersToday,
      },
      last30Days: {
        orders: monthSales[0]?.orders || 0,
        revenue: monthSales[0]?.revenue || 0,
        byDay: fillDays(days, salesByDay, (r) => ({ orders: r?.orders || 0, revenue: r?.revenue || 0 })),
      },
      toDo: {
        newOrders,
        toConfirm: statuses.PENDING || 0,
        toShip: (statuses.CONFIRMED || 0) + (statuses.PACKED || 0),
        inTransit: (statuses.SHIPPED || 0) + (statuses.OUT_FOR_DELIVERY || 0),
        newEnquiries,
        outOfStock,
      },
      statuses,
      liveVisitors,
      customersTotal,
      recentOrders: recentOrders.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customer: o.shippingAddress?.fullName || "",
        city: o.shippingAddress?.city || "",
        total: o.pricing?.total || 0,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        orderStatus: o.orderStatus,
        isNew: !o.adminSeenAt,
      })),
    };
  }

  /** Traffic page: visitors and page views for the last `days` days. */
  async traffic({ days = 30 } = {}, now = new Date()) {
    const span = Math.min(Math.max(Number(days) || 30, 1), 365);
    const list = lastDays(span, now);
    const match = { day: { $gte: list[0] } };
    const liveSince = new Date(now.getTime() - 5 * 60 * 1000);

    const [byDay, topPages, referrers, devices, totals, live] = await Promise.all([
      PageView.aggregate([
        { $match: match },
        { $group: { _id: "$day", views: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
        { $project: { views: 1, visitors: { $size: "$visitors" } } },
      ]),
      PageView.aggregate([
        { $match: match },
        { $group: { _id: "$path", views: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
        { $project: { views: 1, visitors: { $size: "$visitors" } } },
        { $sort: { views: -1 } },
        { $limit: 15 },
      ]),
      PageView.aggregate([
        { $match: match },
        { $group: { _id: { $cond: [{ $eq: ["$referrer", ""] }, "Direct / typed", "$referrer"] }, visitors: { $addToSet: "$visitorId" } } },
        { $project: { visitors: { $size: "$visitors" } } },
        { $sort: { visitors: -1 } },
        { $limit: 10 },
      ]),
      PageView.aggregate([
        { $match: match },
        { $group: { _id: "$device", visitors: { $addToSet: "$visitorId" } } },
        { $project: { visitors: { $size: "$visitors" } } },
      ]),
      PageView.aggregate([
        { $match: match },
        { $group: { _id: null, views: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
        { $project: { views: 1, visitors: { $size: "$visitors" } } },
      ]),
      PageView.aggregate([
        { $match: { at: { $gte: liveSince } } },
        { $sort: { at: -1 } },
        { $group: { _id: "$visitorId", path: { $first: "$path" } } },
        { $group: { _id: "$path", visitors: { $sum: 1 } } },
        { $sort: { visitors: -1 } },
      ]),
    ]);

    return {
      days: span,
      totals: { visitors: totals[0]?.visitors || 0, pageViews: totals[0]?.views || 0 },
      byDay: fillDays(list, byDay, (r) => ({ visitors: r?.visitors || 0, pageViews: r?.views || 0 })),
      topPages: topPages.map((p) => ({ path: p._id, views: p.views, visitors: p.visitors })),
      referrers: referrers.map((r) => ({ source: r._id, visitors: r.visitors })),
      devices: devices.map((d) => ({ device: d._id, visitors: d.visitors })),
      liveNow: {
        visitors: live.reduce((sum, p) => sum + p.visitors, 0),
        pages: live.map((p) => ({ path: p._id, visitors: p.visitors })),
      },
    };
  }

  // ------------------------------------------------------------ customers

  async customers({ q = "", page = 1, limit = 25 } = {}) {
    const filter = { role: { $ne: "admin" } };
    const text = String(q || "").trim();
    if (text) {
      const pattern = new RegExp(escapeRegex(text), "i");
      filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }, { phone: pattern }];
    }
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((current - 1) * size).limit(size).lean(),
      User.countDocuments(filter),
    ]);
    const stats = await Order.aggregate([
      { $match: { user: { $in: users.map((u) => u._id) }, ...SALES } },
      { $group: { _id: "$user", orders: { $sum: 1 }, spent: { $sum: "$pricing.total" }, lastOrderAt: { $max: "$createdAt" } } },
    ]);
    const byUser = new Map(stats.map((s) => [String(s._id), s]));
    return {
      customers: users.map((u) => customerRow(u, byUser.get(String(u._id)))),
      page: current,
      pages: Math.max(Math.ceil(total / size), 1),
      total,
    };
  }

  async customer(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid customer id.");
    const user = await User.findById(id).lean();
    if (!user) throw new HttpError(404, "Customer not found.");
    const orders = await Order.find({ user: user._id, orderStatus: { $ne: "AWAITING_PAYMENT" } }).sort({ createdAt: -1 }).lean();
    const sales = orders.filter((o) => !["CANCELLED", "RETURNED"].includes(o.orderStatus));
    return {
      ...customerRow(user, {
        orders: sales.length,
        spent: sales.reduce((sum, o) => sum + (o.pricing?.total || 0), 0),
        lastOrderAt: orders[0]?.createdAt || null,
      }),
      birthday: user.birthday,
      lastLoginAt: user.lastLoginAt,
      orderHistory: orders.map((o) => ({
        id: String(o._id), orderNumber: o.orderNumber, createdAt: o.createdAt, total: o.pricing?.total || 0,
        orderStatus: o.orderStatus, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
      })),
    };
  }

  /** Disable / re-enable an account (a disabled account can't sign in). */
  async setCustomerActive(id, isActive) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid customer id.");
    const user = await User.findOneAndUpdate({ _id: id, role: { $ne: "admin" } }, { $set: { isActive: Boolean(isActive) } }, { new: true }).lean();
    if (!user) throw new HttpError(404, "Customer not found.");
    return this.customer(id);
  }

  // ------------------------------------------------------------ enquiries

  async enquiries({ status = "", page = 1, limit = 25 } = {}) {
    const filter = status ? { status } : {};
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const [rows, total, counts] = await Promise.all([
      Enquiry.find(filter).sort({ createdAt: -1 }).skip((current - 1) * size).limit(size).lean(),
      Enquiry.countDocuments(filter),
      Enquiry.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    return {
      enquiries: rows.map((e) => ({ ...e, id: String(e._id) })),
      page: current,
      pages: Math.max(Math.ceil(total / size), 1),
      total,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    };
  }

  async setEnquiryStatus(id, status) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid enquiry id.");
    if (!["NEW", "CONTACTED", "CLOSED"].includes(status)) throw new HttpError(400, "Unknown status.");
    const row = await Enquiry.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
    if (!row) throw new HttpError(404, "Enquiry not found.");
    return { ...row, id: String(row._id) };
  }
}

function customerRow(user, stats) {
  return {
    id: String(user._id),
    name: [user.firstName, user.lastName].filter(Boolean).join(" "),
    email: user.email || "",
    phone: user.phone || "",
    signIn: user.phoneVerified && !user.email ? "phone" : "email",
    isActive: user.isActive !== false,
    createdAt: user.createdAt,
    orders: stats?.orders || 0,
    spent: stats?.spent || 0,
    lastOrderAt: stats?.lastOrderAt || null,
  };
}

module.exports = new AdminStatsService();
module.exports.lastDays = lastDays;
