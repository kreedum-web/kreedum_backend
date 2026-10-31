/**
 * Product photos live in Kreedum's own Cloudinary account. Products still
 * arrive from the scraper with the supplier's addresses; these helpers
 * collect them, name them in Cloudinary and swap them for our addresses.
 * Pure functions: no network, no database.
 */
const crypto = require("crypto");

// Served to customers: best format for the browser (WebP / AVIF), automatic
// quality, never wider than 1200px.
const DELIVERY = "f_auto,q_auto,c_limit,w_1200";

/** Every photo address a product uses: gallery, thumbnail, option photos. */
function productImageUrls(product) {
  const urls = [
    product.thumbnail,
    ...(product.images || []),
    ...(product.variants || []).map((variant) => variant.image),
  ];
  return [...new Set(urls.filter((url) => typeof url === "string" && /^https?:\/\//.test(url)))];
}

/** Already in our storage. */
function isOwnImage(url = "") {
  return /^https:\/\/res\.cloudinary\.com\//.test(url);
}

/**
 * Cloudinary name for a supplier photo. Mirrors the supplier's upload path,
 * so it's unique and the same photo always gets the same name:
 *   .../wp-content/uploads/2025/09/AF-404 Treadmill.png -> kreedum/products/2025/09/af-404-treadmill
 */
function publicIdFor(sourceUrl) {
  let path = "";
  try {
    path = decodeURIComponent(new URL(sourceUrl).pathname);
  } catch {
    path = "";
  }
  const match = path.match(/\/uploads\/(.+)$/);
  if (!match) {
    const hash = crypto.createHash("sha1").update(String(sourceUrl)).digest("hex").slice(0, 16);
    return `kreedum/products/other/${hash}`;
  }
  const parts = match[1].split("/").map((part, index, all) => {
    const name = index === all.length - 1 ? part.replace(/\.[a-z0-9]+$/i, "") : part;
    return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "image";
  });
  return `kreedum/products/${parts.join("/")}`;
}

/**
 * Cloudinary names for photos about to be uploaded. Two different files that
 * clean up to the same name (A.png / A.jpg) get a short unique suffix, so
 * one never shows the other's photo.
 * @param {string[]} sourceUrls
 * @param {Map<string,string>} taken  publicId -> sourceUrl, from earlier uploads
 * @returns {Map<string,string>} sourceUrl -> publicId
 */
function assignPublicIds(sourceUrls, taken = new Map()) {
  const used = new Map(taken);
  const result = new Map();
  for (const sourceUrl of sourceUrls) {
    let id = publicIdFor(sourceUrl);
    if (used.has(id) && used.get(id) !== sourceUrl) {
      id = `${id}-${crypto.createHash("sha1").update(sourceUrl).digest("hex").slice(0, 8)}`;
    }
    used.set(id, sourceUrl);
    result.set(sourceUrl, id);
  }
  return result;
}

/** Customer-facing address of an uploaded photo (adds the delivery settings). */
function deliveryUrl(secureUrl = "") {
  return secureUrl.includes("/image/upload/") && !secureUrl.includes(`/upload/${DELIVERY}/`)
    ? secureUrl.replace("/image/upload/", `/image/upload/${DELIVERY}/`)
    : secureUrl;
}

/**
 * The same product with every supplier photo that's been uploaded replaced
 * by our address. Photos not uploaded yet keep their supplier address.
 * @param {Map<string,string>} imageMap  sourceUrl -> our url
 */
function withOwnImages(product, imageMap) {
  if (!imageMap || !imageMap.size) return product;
  const swap = (url) => (url && imageMap.get(url)) || url;
  return {
    ...product,
    ...(product.thumbnail !== undefined ? { thumbnail: swap(product.thumbnail) } : {}),
    ...(product.images ? { images: product.images.map(swap) } : {}),
    ...(product.variants ? { variants: product.variants.map((v) => (v.image ? { ...v, image: swap(v.image) } : v)) } : {}),
  };
}

module.exports = { productImageUrls, isOwnImage, publicIdFor, assignPublicIds, deliveryUrl, withOwnImages, DELIVERY };
