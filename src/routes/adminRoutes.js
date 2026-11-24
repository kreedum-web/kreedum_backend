const express = require("express");
const router = express.Router();

const adminOnly = require("../middleware/adminOnly");
const orders = require("../services/admin/adminOrderService");
const products = require("../services/admin/adminProductService");
const content = require("../services/admin/adminContentService");
const stats = require("../services/admin/adminStatsService");
const notifications = require("../services/admin/adminNotificationService");
const carts = require("../services/admin/adminCartService");
const categories = require("../services/admin/adminCategoryService");
const homeSections = require("../services/admin/adminHomeSectionService");

/**
 * Admin dashboard API (admin.kreedum.com). Every route needs a signed-in
 * account with role "admin" (npm run admin:make -- email).
 *
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin dashboard (admins only)
 */
router.use(adminOnly);

/** Wraps a handler: sends { success: true, data } or the error as JSON. */
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json({ success: true, data });
  } catch (error) {
    if (!error.status) console.error("Admin API error:", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Something went wrong. Please try again.",
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

/**
 * @swagger
 * /api/v1/admin/me:
 *   get: { summary: The signed-in admin, tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/me", handle((req) => ({
  id: String(req.user._id),
  name: [req.user.firstName, req.user.lastName].filter(Boolean).join(" "),
  email: req.user.email,
  role: req.user.role,
})));

// ---------------------------------------------------------------- dashboard
/**
 * @swagger
 * /api/v1/admin/overview:
 *   get: { summary: "Home page: today's sales, to-do counts, last 30 days, recent orders", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/traffic:
 *   get: { summary: "Visitors, page views, top pages, sources (?days=30)", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/overview", handle(() => stats.overview()));
router.get("/traffic", handle((req) => stats.traffic(req.query)));

// ---------------------------------------------------------------- notifications
/**
 * @swagger
 * /api/v1/admin/notifications:
 *   get: { summary: "Newest 20 alerts (last 2 days), unread count, orders not opened yet", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   delete: { summary: "Clear all alerts", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/notifications/read:
 *   post: { summary: "Mark as read: { id } for one, nothing for all", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/notifications", handle(() => notifications.list()));
router.post("/notifications/read", handle((req) => notifications.markRead(req.body?.id)));
router.delete("/notifications", handle(() => notifications.clear()));

// ---------------------------------------------------------------- carts & wishlists
/**
 * @swagger
 * /api/v1/admin/carts:
 *   get: { summary: "Customers with items in cart (?type=cart) or wishlist (?type=wishlist); ?q=&idle=24&page=", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/carts/{userId}:
 *   get: { summary: "One customer's cart, wishlist, recent orders and follow-up notes", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/carts/{userId}/follow-ups:
 *   post: { summary: "Add a follow-up note: { note, about: cart|wishlist|general, channel: call|whatsapp|email|other }", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/carts", handle((req) => carts.list(req.query)));
router.get("/carts/:userId", handle((req) => carts.detail(req.params.userId)));
router.post("/carts/:userId/follow-ups", handle((req) => carts.addFollowUp(req.params.userId, req.body, req.user)));

// ---------------------------------------------------------------- orders
/**
 * @swagger
 * /api/v1/admin/orders:
 *   get: { summary: "Orders (?status=NEW|ACTIVE|PENDING…&q=&payment=COD|ONLINE&page=)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/orders/feed:
 *   get: { summary: "Orders not opened yet, for live new-order alerts", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/orders/seen:
 *   post: { summary: "Mark every order as seen", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/orders/{id}:
 *   get: { summary: "One order (marks it as seen)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/orders/{id}/status:
 *   patch: { summary: "Move an order on: { status, note }", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/orders", handle((req) => orders.list(req.query)));
router.get("/orders/feed", handle(() => orders.feed()));
router.post("/orders/seen", handle(() => orders.markAllSeen()));
router.get("/orders/:id", handle((req) => orders.get(req.params.id)));
router.patch("/orders/:id/status", handle((req) => orders.updateStatus(req.params.id, req.body)));

// ---------------------------------------------------------------- products & brands
/**
 * @swagger
 * /api/v1/admin/products:
 *   get: { summary: "Products (?q=&brand=&department=&category=&state=live|hidden|locked&stock=&page=)", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   post: { summary: "Add a product by hand: { name, brand, categorySlug, sellingPrice, mrp, stockStatus, sku, descriptionText, features, live }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/products/bulk-live:
 *   post: { summary: "Show or hide every product matching the filters: { filters: { q, brand, department, category, state, stock }, live, dryRun }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/products/{id}:
 *   get: { summary: "One product", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   delete: { summary: "Delete a product added by hand", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   patch: { summary: "Change price, name, stock, on/off, option prices, photo order, brand ({ brand }), category ({ categorySlug })", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/products/{id}/images:
 *   post: { summary: "Add a photo: { data: 'data:image/…', makeMain }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/products/{id}/reset:
 *   post: { summary: "Forget hand edits; next catalogue rebuild restores Metro's values", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/brands:
 *   get: { summary: "Brands", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/brands/{slug}:
 *   patch: { summary: "{ live, featured, description, logo }", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/products", handle((req) => products.list(req.query)));
router.post("/products", handle((req) => products.create(req.body)));
router.post("/products/bulk-live", handle((req) => products.bulkSetLive(req.body)));
router.post("/products/bulk-ready-stock", handle((req) => products.bulkSetReadyStock(req.body)));
router.get("/products/:id", handle((req) => products.get(req.params.id)));
router.delete("/products/:id", handle((req) => products.remove(req.params.id)));
router.patch("/products/:id", handle((req) => products.update(req.params.id, req.body)));
router.post("/products/:id/images", handle((req) => products.addImage(req.params.id, req.body)));
router.post("/products/:id/reset", handle((req) => products.resetToSupplier(req.params.id)));
router.get("/brands", handle(() => products.listBrands()));
router.patch("/brands/:slug", handle((req) => products.updateBrand(req.params.slug, req.body)));

// ---------------------------------------------------------------- categories
/**
 * @swagger
 * /api/v1/admin/categories:
 *   get: { summary: "All categories (menu order) with product counts", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   post: { summary: "New category: { name, parentSlug (empty = top level), displayOrder? }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/categories/{slug}:
 *   patch: { summary: "{ name, displayOrder, isActive }: kept by the catalogue rebuild", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   delete: { summary: "Delete a category made in the admin (empty, no sub-categories)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/categories/{slug}/reset:
 *   post: { summary: "Forget edits on a supplier category; next rebuild restores Metro's values", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/categories", handle((req) => categories.list(req.query)));
router.post("/categories", handle((req) => categories.create(req.body)));

/**
 * @openapi
 * /api/v1/admin/home-sections:
 *   get: { summary: "Home page product rows, in order", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   post: { summary: "New custom row: { title, subtitle, limit, startsAt, endsAt, autoFill, filters: { categorySlug, brandSlugs, minPrice, maxPrice, minDiscount, readyStockOnly, sort } }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/home-sections/reorder:
 *   post: { summary: "Order of the rows: { ids: [...] } top to bottom", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/home-sections/{id}:
 *   patch: { summary: "Change a row (title, subtitle, isVisible, limit, dates; custom: autoFill, filters)", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   delete: { summary: "Delete a custom row", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/home-sections/{id}/picks:
 *   get: { summary: "A row's picked products, in order", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   put: { summary: "Set a row's picks: { productIds: [...] }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/home-sections/{id}/preview:
 *   get: { summary: "What the row shows now (picks, then its rule)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/products/bulk-ready-stock:
 *   post: { summary: "Mark / unmark every product matching the filters as ready stock: { filters, readyStock, dryRun }", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/home-sections", handle(() => homeSections.list()));
router.post("/home-sections", handle((req) => homeSections.create(req.body)));
router.post("/home-sections/reorder", handle((req) => homeSections.reorder(req.body?.ids)));
router.patch("/home-sections/:id", handle((req) => homeSections.update(req.params.id, req.body)));
router.delete("/home-sections/:id", handle((req) => homeSections.remove(req.params.id)));
router.get("/home-sections/:id/picks", handle((req) => homeSections.picks(req.params.id)));
router.put("/home-sections/:id/picks", handle((req) => homeSections.setPicks(req.params.id, req.body?.productIds)));
router.get("/home-sections/:id/preview", handle((req) => homeSections.preview(req.params.id)));
router.patch("/categories/:slug", handle((req) => categories.update(req.params.slug, req.body)));
router.delete("/categories/:slug", handle((req) => categories.remove(req.params.slug)));
router.post("/categories/:slug/reset", handle((req) => categories.reset(req.params.slug)));

// ---------------------------------------------------------------- site content
/**
 * @swagger
 * /api/v1/admin/content/{kind}:
 *   get: { summary: "kind = hero | announcements | leaders | clients", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   post: { summary: "Add one (image: 'data:image/…' to upload a picture)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/content/{kind}/order:
 *   put: { summary: "New display order: { ids: [...] }", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/content/{kind}/{id}:
 *   patch: { summary: "Change one", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   delete: { summary: "Delete one", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/content/:kind", handle((req) => content.list(req.params.kind)));
router.post("/content/:kind", handle((req) => content.save(req.params.kind, null, req.body)));
router.put("/content/:kind/order", handle((req) => content.reorder(req.params.kind, req.body?.ids)));
router.patch("/content/:kind/:id", handle((req) => content.save(req.params.kind, req.params.id, req.body)));
router.delete("/content/:kind/:id", handle((req) => content.remove(req.params.kind, req.params.id)));

// ---------------------------------------------------------------- customers & enquiries
/**
 * @swagger
 * /api/v1/admin/customers:
 *   get: { summary: "Customers with order count and total spent (?q=&page=)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/customers/{id}:
 *   get: { summary: "One customer and their orders", tags: [Admin], security: [{ bearerAuth: [] }] }
 *   patch: { summary: "{ isActive } — disable / re-enable the account", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/enquiries:
 *   get: { summary: "Enquiries (?kind=bulk|contact|product|whatsapp&status=NEW|CONTACTED|CLOSED&page=)", tags: [Admin], security: [{ bearerAuth: [] }] }
 * /api/v1/admin/enquiries/{id}:
 *   patch: { summary: "{ status }", tags: [Admin], security: [{ bearerAuth: [] }] }
 */
router.get("/customers", handle((req) => stats.customers(req.query)));
router.get("/customers/:id", handle((req) => stats.customer(req.params.id)));
router.patch("/customers/:id", handle((req) => stats.setCustomerActive(req.params.id, req.body?.isActive)));
router.get("/enquiries", handle((req) => stats.enquiries(req.query)));
router.patch("/enquiries/:id", handle((req) => stats.setEnquiryStatus(req.params.id, req.body?.status)));

module.exports = router;
