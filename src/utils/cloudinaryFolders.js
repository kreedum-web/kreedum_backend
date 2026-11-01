/**
 * Kreedum's Cloudinary layout. Every site image goes in its own folder:
 *
 *   kreedum/products        product photos (npm run images:upload)
 *   kreedum/homepage/hero   home page hero / offer banners
 *   kreedum/leaders         About Us leadership photos
 *   kreedum/clients         client logos (home page strip)
 *
 * Each kind is stored at most `storeMax` px and delivered to customers as
 * WebP / AVIF at most `deliverMax` px.
 *
 * Cloudinary accounts created after June 2024 use "dynamic folders": the
 * folder shown in the Media Library (asset_folder) is separate from the
 * image's name (public_id). Every upload sets both, so images land in their
 * folder; `npm run images:folders` moves images uploaded before that.
 */
const { v2: cloudinary } = require("cloudinary");

const KINDS = {
  products: { folder: "kreedum/products", storeMax: 1600, deliverMax: 1200 },
  hero: { folder: "kreedum/homepage/hero", storeMax: 2400, deliverMax: 1920 },
  leaders: { folder: "kreedum/leaders", storeMax: 1200, deliverMax: 800 },
  clients: { folder: "kreedum/clients", storeMax: 600, deliverMax: 400 },
};

/** Media Library folder for an image, from its name: kreedum/products/2025/09/x -> kreedum/products. */
function assetFolderFor(publicId = "") {
  const kind = Object.values(KINDS).find(({ folder }) => publicId.startsWith(`${folder}/`));
  if (kind) return kind.folder;
  const slash = publicId.lastIndexOf("/");
  return slash === -1 ? "" : publicId.slice(0, slash);
}

/** "Integral University, Lucknow" -> "integral-university-lucknow" */
function fileName(name = "") {
  return (
    String(name)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

/** Customer-facing address: best format, automatic quality, size limit for the kind. */
function deliveryUrl(secureUrl, kind) {
  const settings = `f_auto,q_auto,c_limit,w_${KINDS[kind].deliverMax}`;
  if (!secureUrl || !secureUrl.includes("/image/upload/") || secureUrl.includes(`/upload/${settings}/`)) {
    return secureUrl;
  }
  return secureUrl.replace("/image/upload/", `/image/upload/${settings}/`);
}

/**
 * CLOUDINARY_URL must be cloudinary://<api key>:<api secret>@<cloud name>
 * with the real values (catches the template pasted as it is).
 */
function checkCloudinaryUrl(value = process.env.CLOUDINARY_URL || "") {
  const where = "Cloudinary → Settings → API Keys";
  if (!value) throw new Error(`CLOUDINARY_URL is missing in .env. Copy the "API environment variable" from ${where}.`);
  if (/[<>]|your_api/i.test(value)) {
    throw new Error(`CLOUDINARY_URL in .env still has the placeholders. Put your real API Key and API Secret from ${where} in their place.`);
  }
  if (!/^cloudinary:\/\/\d+:[^@\s]+@[\w-]+$/.test(value.trim())) {
    throw new Error(`CLOUDINARY_URL in .env should look like cloudinary://123456789012345:yourSecret@yourcloud. Check it against ${where}.`);
  }
}

/**
 * Upload one image (local file path, web address or data URI) into the
 * folder for its kind, named after `name`.
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function uploadImage(source, { kind, name, overwrite = false }) {
  const settings = KINDS[kind];
  if (!settings) throw new Error(`Unknown image kind "${kind}"`);

  const result = await cloudinary.uploader.upload(source, {
    public_id: `${settings.folder}/${fileName(name)}`,
    asset_folder: settings.folder,
    overwrite,
    invalidate: overwrite,
    unique_filename: false,
    resource_type: "image",
    transformation: [{ width: settings.storeMax, height: settings.storeMax, crop: "limit" }],
  });

  return { url: deliveryUrl(result.secure_url, kind), publicId: result.public_id };
}

module.exports = { KINDS, assetFolderFor, fileName, deliveryUrl, checkCloudinaryUrl, uploadImage };
