const mongoose = require("mongoose");

const Cart = require("../../models/Cart");
const Wishlist = require("../../models/Wishlist");
const Product = require("../../models/Product");
const User = require("../../models/User");
const Order = require("../../models/Order");
const FollowUp = require("../../models/FollowUp");
const HttpError = require("../../utils/httpError");

/**
 * Carts and wishlists of signed-in customers, for the team to follow up
 * ("you left these in your cart …"). The store already saves both per
 * account (collections "cart" and "wishlists"); nothing extra is tracked.
 * Guests can't add to cart or wishlist without signing in, so every entry
 * here has a name or contact.
 */

const HOUR = 60 * 60 * 1000;

function checkId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid customer id.");
}

/** Price of one cart line: the chosen option's price, else the product's. */
function linePrice(product, variantId) {
  if (variantId && product?.variants?.length) {
    const v = product.variants.find((x) => x.variantId === variantId);
    if (v) return { price: v.sellingPrice || 0, label: v.label || "", inStock: v.inStock !== false };
  }
  return { price: product?.sellingPrice || 0, label: "", inStock: product?.stockStatus !== "out_of_stock" };
}

const contactOf = (u) => ({
  id: String(u._id),
  name: [u.firstName, u.lastName].filter(Boolean).join(" "),
  email: u.email || "",
  phone: u.phone || "",
  createdAt: u.createdAt,
});

class AdminCartService {
  /**
   * Customers with something in their cart (type "cart") or wishlist
   * (type "wishlist"), most recently changed first.
   * idle: only those untouched for at least this many hours (e.g. 24).
   */
  async list({ type = "cart", q = "", idle = 0, page = 1, limit = 20 } = {}) {
    const Model = type === "wishlist" ? Wishlist : Cart;
    const groups = await Model.aggregate([
      {
        $group: {
          _id: "$user",
          lines: { $sum: 1 },
          quantity: { $sum: { $ifNull: ["$quantity", 1] } },
          updatedAt: { $max: "$updatedAt" },
          items: { $push: { product: "$product", variantId: { $ifNull: ["$variantId", ""] }, quantity: { $ifNull: ["$quantity", 1] } } },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);

    // Customers only (not admins), matching the search.
    const users = await User.find({ _id: { $in: groups.map((g) => g._id) }, role: { $ne: "admin" } })
      .select("firstName lastName email phone createdAt")
      .lean();
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const text = String(q || "").trim().toLowerCase();
    const idleSince = Number(idle) > 0 ? Date.now() - Number(idle) * HOUR : null;

    const matching = groups.filter((g) => {
      const u = userById.get(String(g._id));
      if (!u) return false;
      if (idleSince && new Date(g.updatedAt).getTime() > idleSince) return false;
      if (!text) return true;
      return [u.firstName, u.lastName, u.email, u.phone].some((v) => String(v || "").toLowerCase().includes(text));
    });

    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const pageGroups = matching.slice((current - 1) * size, current * size);

    const productIds = [...new Set(pageGroups.flatMap((g) => g.items.map((i) => String(i.product))))];
    const userIds = pageGroups.map((g) => g._id);
    const [products, lastNotes, lastOrders] = await Promise.all([
      Product.find({ _id: { $in: productIds } }).select("name slug thumbnail images sellingPrice variants stockStatus").lean(),
      FollowUp.aggregate([
        { $match: { user: { $in: userIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$user", at: { $first: "$createdAt" }, note: { $first: "$note" }, by: { $first: "$by" } } },
      ]),
      Order.aggregate([
        { $match: { user: { $in: userIds }, orderStatus: { $nin: ["AWAITING_PAYMENT"] } } },
        { $group: { _id: "$user", orders: { $sum: 1 }, lastOrderAt: { $max: "$createdAt" } } },
      ]),
    ]);
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const noteByUser = new Map(lastNotes.map((n) => [String(n._id), n]));
    const ordersByUser = new Map(lastOrders.map((o) => [String(o._id), o]));

    const rows = pageGroups.map((g) => {
      const items = g.items
        .map((i) => ({ ...i, product: productById.get(String(i.product)) }))
        .filter((i) => i.product);
      const value = items.reduce((sum, i) => sum + linePrice(i.product, i.variantId).price * (i.quantity || 1), 0);
      const note = noteByUser.get(String(g._id));
      const orders = ordersByUser.get(String(g._id));
      return {
        customer: contactOf(userById.get(String(g._id))),
        lines: items.length,
        quantity: items.reduce((sum, i) => sum + (i.quantity || 1), 0),
        value,
        updatedAt: g.updatedAt,
        preview: items.slice(0, 4).map((i) => ({
          name: i.product.name,
          thumbnail: i.product.thumbnail || i.product.images?.[0] || "",
        })),
        lastFollowUp: note ? { at: note.at, note: note.note, by: note.by } : null,
        orders: orders?.orders || 0,
        lastOrderAt: orders?.lastOrderAt || null,
      };
    });

    return { type, rows, page: current, pages: Math.max(Math.ceil(matching.length / size), 1), total: matching.length };
  }

  /** One customer's cart, wishlist, orders summary and follow-up notes. */
  async detail(userId) {
    checkId(userId);
    const user = await User.findById(userId).select("firstName lastName email phone createdAt lastLoginAt").lean();
    if (!user) throw new HttpError(404, "Customer not found.");

    const [cart, wishlist, notes, orders] = await Promise.all([
      Cart.find({ user: user._id }).sort({ updatedAt: -1 }).populate("product", "name slug thumbnail images sellingPrice mrp variants stockStatus isActive visibility").lean(),
      Wishlist.find({ user: user._id }).sort({ createdAt: -1 }).populate("product", "name slug thumbnail images sellingPrice mrp stockStatus isActive visibility").lean(),
      FollowUp.find({ user: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
      Order.find({ user: user._id, orderStatus: { $ne: "AWAITING_PAYMENT" } }).sort({ createdAt: -1 }).limit(5).select("orderNumber createdAt orderStatus pricing.total").lean(),
    ]);

    const item = (row) => {
      const p = row.product;
      const { price, label, inStock } = linePrice(p, row.variantId);
      const quantity = row.quantity || 1;
      return {
        productId: String(p._id),
        name: p.name,
        slug: p.slug,
        thumbnail: p.thumbnail || p.images?.[0] || "",
        option: label,
        price,
        quantity,
        total: price * quantity,
        available: p.isActive !== false && p.visibility === "published" && inStock,
        addedAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    };
    const cartItems = cart.filter((r) => r.product).map(item);
    const wishlistItems = wishlist.filter((r) => r.product).map(item);

    return {
      customer: { ...contactOf(user), lastLoginAt: user.lastLoginAt || null },
      cart: { items: cartItems, value: cartItems.reduce((s, i) => s + i.total, 0) },
      wishlist: { items: wishlistItems, value: wishlistItems.reduce((s, i) => s + i.price, 0) },
      orders: orders.map((o) => ({ id: String(o._id), orderNumber: o.orderNumber, createdAt: o.createdAt, orderStatus: o.orderStatus, total: o.pricing?.total || 0 })),
      followUps: notes.map((n) => ({ id: String(n._id), about: n.about, channel: n.channel, note: n.note, by: n.by, createdAt: n.createdAt })),
    };
  }

  /** Save a follow-up note: { note, about?, channel? }. */
  async addFollowUp(userId, body = {}, admin) {
    checkId(userId);
    const note = String(body.note || "").trim();
    if (!note) throw new HttpError(400, "Please write what happened.");
    if (!(await User.exists({ _id: userId }))) throw new HttpError(404, "Customer not found.");
    await FollowUp.create({
      user: userId,
      note: note.slice(0, 1000),
      about: ["cart", "wishlist", "general"].includes(body.about) ? body.about : "cart",
      channel: ["call", "whatsapp", "email", "other"].includes(body.channel) ? body.channel : "call",
      by: [admin?.firstName, admin?.lastName].filter(Boolean).join(" ") || admin?.email || "",
    });
    return this.detail(userId);
  }
}

module.exports = new AdminCartService();
module.exports.linePrice = linePrice;
