const PageView = require("../models/PageView");

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|facebookexternalhit|whatsapp/i;
const IST_OFFSET_MS = 330 * 60 * 1000; // India is UTC+5:30

/** "2026-11-18": the India date of a moment. */
function indiaDay(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of an India day ("2026-11-18") as a Date. */
function indiaDayStart(day) {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

function deviceOf(userAgent = "") {
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return "tablet";
  if (/mobi|android|iphone/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** "https://www.google.com/search?q=…" → "google.com"; our own site → "" (internal). */
function referrerHost(referrer = "") {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    if (!host || /(^|\.)kreedum\.com$|vercel\.app$|localhost/.test(host)) return "";
    return host.slice(0, 120);
  } catch {
    return "";
  }
}

/** Keep only the page address: no domain, no query string (it can hold personal details). */
function cleanPath(path = "") {
  const text = String(path || "/").split(/[?#]/)[0].trim();
  return (text.startsWith("/") ? text : `/${text}`).slice(0, 300);
}

/**
 * Save one page view. Returns false (and saves nothing) for bots and
 * malformed requests: tracking must never break the website.
 */
async function recordView({ visitorId, path, referrer, signedIn }, { userAgent = "" } = {}) {
  if (BOT_PATTERN.test(userAgent)) return false;
  const id = String(visitorId || "").trim();
  if (!/^[\w-]{8,64}$/.test(id)) return false;

  const now = new Date();
  await PageView.create({
    visitorId: id,
    path: cleanPath(path),
    referrer: referrerHost(referrer),
    device: deviceOf(userAgent),
    signedIn: Boolean(signedIn),
    day: indiaDay(now),
    at: now,
  });
  return true;
}

module.exports = { recordView, indiaDay, indiaDayStart, deviceOf, referrerHost, cleanPath };
