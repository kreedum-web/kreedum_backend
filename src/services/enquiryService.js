const Enquiry = require("../models/Enquiry");
const Product = require("../models/Product");
const HttpError = require("../utils/httpError");
const notifications = require("./notificationService");

/**
 * Bulk enquiries ("Bulk Enquiry" on the website). No sign-in needed.
 * Saved here when the customer presses "Send enquiry"; the website then
 * opens WhatsApp with the same details for them to send to us.
 */

// The choices on the form (also checked here, so the saved data stays tidy).
const OPTIONS = {
  facilityType: [
    "Commercial Gym",
    "School / College",
    "Corporate / Office",
    "Apartment / Society",
    "Sports Academy",
    "Government / Institution",
    "Home Gym",
    "Other",
  ],
  equipmentNeed: [
    "Cardio (treadmills, cycles, cross-trainers)",
    "Strength & selectorized machines",
    "Free weights & plates",
    "Benches & racks",
    "Functional / crossfit training",
    "Outdoor gym equipment",
    "Sports goods (balls, nets, kits)",
    "Full gym setup",
    "Other",
  ],
  budget: ["Under ₹2 lakh", "₹2 – 5 lakh", "₹5 – 10 lakh", "₹10 lakh+", "Not sure yet"],
  timeline: ["< 1 month", "1 – 3 months", "3 – 6 months", "Just exploring"],
};

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Clean what the form sent; throws 400 with a message per field. */
function cleanEnquiry(body = {}) {
  const data = {
    name: clip(body.name, 80),
    phone: String(body.phone ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""),
    email: clip(body.email, 120).toLowerCase(),
    city: clip(body.city, 60),
    organisation: clip(body.organisation, 120),
    facilityType: clip(body.facilityType, 60),
    equipmentNeed: clip(body.equipmentNeed, 80),
    budget: clip(body.budget, 40),
    timeline: clip(body.timeline, 40),
    message: String(body.message ?? "").trim().slice(0, 2000),
    page: clip(body.page, 200),
  };

  const errors = {};
  if (data.name.length < 2) errors.name = "Please enter your name.";
  if (!/^[6-9]\d{9}$/.test(data.phone)) errors.phone = "Please enter a valid 10-digit mobile number.";
  if (data.email && !EMAIL.test(data.email)) errors.email = "Please enter a valid email address.";
  if (!data.city) errors.city = "Please enter your city.";
  for (const field of ["facilityType", "equipmentNeed", "budget", "timeline"]) {
    if (data[field] && !OPTIONS[field].includes(data[field])) data[field] = "Other";
  }

  if (Object.keys(errors).length) {
    throw new HttpError(400, Object.values(errors)[0], "INVALID_ENQUIRY", { errors });
  }
  return data;
}

/**
 * Save the enquiry. `user` is the signed-in customer (or null).
 * @returns {{ id: string|null, signedIn: boolean }}
 */
async function submitEnquiry(body, { user = null, ip = "" } = {}) {
  // Bots fill in every field, including this hidden one.
  if (clip(body?.website, 200)) return { id: null, signedIn: false };

  const data = cleanEnquiry(body);
  const enquiry = await Enquiry.create({
    ...data,
    signedIn: Boolean(user),
    user: user?._id || null,
    accountLogin: user ? user.email || user.phone || "" : "",
    ip,
  });
  notifications.newEnquiry(enquiry);
  return { id: String(enquiry._id), signedIn: Boolean(user) };
}

// ------------------------------------------------------------ contact form

const CONTACT_TOPICS = ["Product enquiry", "Order support", "Bulk order", "Returns & refunds", "Partnership", "Other"];

/**
 * The Contact Us page form: saved here, then the website opens WhatsApp
 * with the same text. body: { name, phone, email?, topic, message, page? }
 */
async function submitContact(body = {}, { user = null, ip = "" } = {}) {
  if (clip(body?.website, 200)) return { id: null };

  const data = {
    name: clip(body.name, 80),
    phone: String(body.phone ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""),
    email: clip(body.email, 120).toLowerCase(),
    topic: clip(body.topic, 60),
    message: String(body.message ?? "").trim().slice(0, 2000),
    page: clip(body.page, 200),
  };
  if (data.name.length < 2) throw new HttpError(400, "Please enter your name.", "INVALID_ENQUIRY");
  if (!/^[6-9]\d{9}$/.test(data.phone)) throw new HttpError(400, "Please enter a valid 10-digit mobile number.", "INVALID_ENQUIRY");
  if (data.email && !EMAIL.test(data.email)) throw new HttpError(400, "Please enter a valid email address.", "INVALID_ENQUIRY");
  if (!data.message) throw new HttpError(400, "Please write your message.", "INVALID_ENQUIRY");
  if (data.topic && !CONTACT_TOPICS.includes(data.topic)) data.topic = clip(data.topic, 40);

  const enquiry = await Enquiry.create({
    kind: "contact",
    ...data,
    signedIn: Boolean(user),
    user: user?._id || null,
    accountLogin: user ? user.email || user.phone || "" : "",
    ip,
  });
  notifications.newEnquiry(enquiry);
  return { id: String(enquiry._id) };
}

// ------------------------------------------------------------ WhatsApp clicks

const REPEAT_WINDOW_MS = 30 * 60 * 1000; // same person + product within 30 min = one enquiry
const SOURCES = ["floating", "product-page", "product-card", "footer", "contact-page", "bulk-page", "order-help", "other"];

/**
 * A WhatsApp button was pressed on the website. We can't see the message
 * (it goes to WhatsApp), but we record who (if signed in), from where, and
 * about which product, so the team knows a chat is coming.
 * body: { visitorId, source, productSlug?, sku?, quantity?, orderNumber?, page? }
 */
async function logWhatsappClick(body = {}, { user = null, ip = "" } = {}) {
  const visitorId = String(body.visitorId || "").trim();
  if (!user && !/^[\w-]{8,64}$/.test(visitorId)) return { saved: false };

  const source = SOURCES.includes(body.source) ? body.source : "other";
  const slug = clip(body.productSlug, 200);
  const product = slug ? await Product.findOne({ slug }, { name: 1, slug: 1, sku: 1 }).lean() : null;
  const kind = (source === "product-page" || source === "product-card") && product ? "product" : "whatsapp";

  // Pressed again soon after (or opened WhatsApp twice): count it, don't re-alert.
  const who = user ? { user: user._id } : { visitorId, user: null };
  const recent = await Enquiry.findOneAndUpdate(
    {
      ...who,
      kind,
      productSlug: product?.slug || "",
      createdAt: { $gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
    },
    { $inc: { clicks: 1 }, $set: { lastClickAt: new Date() } },
    { new: true }
  );
  if (recent) return { saved: true, repeat: true };

  const quantity = Math.min(Math.max(parseInt(body.quantity, 10) || 0, 0), 9999);
  const enquiry = await Enquiry.create({
    kind,
    source,
    name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "",
    phone: user?.phone || "",
    email: user?.email || "",
    product: product?._id || null,
    productName: product?.name || "",
    productSlug: product?.slug || "",
    sku: clip(body.sku, 60) || product?.sku || "",
    quantity,
    orderNumber: clip(body.orderNumber, 40),
    page: clip(body.page, 200),
    visitorId,
    signedIn: Boolean(user),
    user: user?._id || null,
    accountLogin: user ? user.email || user.phone || "" : "",
    lastClickAt: new Date(),
    ip,
  });
  notifications.newEnquiry(enquiry);
  return { saved: true, repeat: false };
}

module.exports = { submitEnquiry, cleanEnquiry, submitContact, logWhatsappClick, OPTIONS, CONTACT_TOPICS, SOURCES };
