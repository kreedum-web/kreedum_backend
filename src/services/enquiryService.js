const Enquiry = require("../models/Enquiry");
const HttpError = require("../utils/httpError");
const { sendMail } = require("../utils/mailer");
const { bulkEnquiryEmail, enquiryReceivedEmail } = require("../emails/templates");

/**
 * Bulk enquiries ("Get a quote" on the website). No sign-in needed.
 *
 * .env:
 *   ENQUIRY_EMAIL=kreedumsports.official@gmail.com   where new enquiries are sent
 *                                                    (several: comma-separated)
 */
const DEFAULT_TO = "kreedumsports.official@gmail.com";

// The choices on the form (also checked here, so the email stays tidy).
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

function recipients(env = process.env) {
  return (env.ENQUIRY_EMAIL || DEFAULT_TO)
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .join(", ");
}

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
  if (!data.equipmentNeed) errors.equipmentNeed = "Please choose what you need.";

  if (Object.keys(errors).length) {
    throw new HttpError(400, Object.values(errors)[0], "INVALID_ENQUIRY", { errors });
  }
  return data;
}

/**
 * Save the enquiry and email it to the team. The customer gets a short
 * "we've got it" email when they gave an address. Email problems never fail
 * the request: the enquiry is saved either way.
 */
async function submitEnquiry(body, { ip = "" } = {}) {
  // Bots fill in every field, including this hidden one.
  if (clip(body?.website, 200)) return { id: null, emailSent: false };

  const data = cleanEnquiry(body);
  const enquiry = await Enquiry.create({ ...data, ip });

  let emailSent = false;
  try {
    const result = await sendMail({
      to: recipients(),
      ...bulkEnquiryEmail({ enquiry: { ...data, createdAt: enquiry.createdAt } }),
      ...(data.email ? { replyTo: data.email } : {}),
    });
    emailSent = Boolean(result?.sent);
  } catch (error) {
    console.error("Bulk enquiry email failed:", error.message);
  }

  if (data.email) {
    sendMail({ to: data.email, ...enquiryReceivedEmail({ name: data.name.split(" ")[0] }) }).catch((error) =>
      console.error("Enquiry confirmation email failed:", error.message)
    );
  }

  if (emailSent) {
    await Enquiry.updateOne({ _id: enquiry._id }, { $set: { emailSent: true } }).catch(() => {});
  }
  return { id: String(enquiry._id), emailSent };
}

module.exports = { submitEnquiry, cleanEnquiry, recipients, OPTIONS };
