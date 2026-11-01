/**
 * Put Kreedum's images into their Media Library folders in Cloudinary.
 *
 * Accounts created after June 2024 use "dynamic folders": the folder shown in
 * the Media Library is separate from the image's name. Images uploaded before
 * uploads set that folder sit in Home; this moves each into its folder:
 *
 *   kreedum/products, kreedum/homepage/hero, kreedum/leaders, kreedum/clients
 *
 * Moving changes nothing on the website (image addresses stay the same).
 *
 *   npm run images:folders               dry run: how many need moving
 *   npm run images:folders -- --apply    move them
 *
 * The free plan allows about 500 of these requests an hour, so one run moves
 * up to 450 and stops; run it again after an hour until it says everything is
 * in place. Needs CLOUDINARY_URL in .env.
 */
require("../config/bootstrap");

const { v2: cloudinary } = require("cloudinary");
const { assetFolderFor, checkCloudinaryUrl } = require("../utils/cloudinaryFolders");

const PER_RUN = 450;

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

// The Cloudinary package rejects with { error: { message, http_code } }.
const unwrap = (error) => error?.error || error || {};
const errorMessage = (error) => unwrap(error).message || String(error);
const isRateLimit = (error) => {
  const { http_code: code, message = "" } = unwrap(error);
  return code === 420 || code === 429 || /rate limit/i.test(message);
};
// Stop with a few requests to spare (Cloudinary reports what's left).
const SPARE = 3;

/** Every Kreedum image with the folder it's in now and the one it belongs in. */
async function listImages(api = cloudinary.api) {
  const images = [];
  let cursor;
  do {
    const page = await api.resources({
      type: "upload",
      resource_type: "image",
      prefix: "kreedum/",
      max_results: 500,
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    for (const resource of page.resources || []) {
      images.push({
        publicId: resource.public_id,
        current: resource.asset_folder || "",
        target: assetFolderFor(resource.public_id),
      });
    }
    cursor = page.next_cursor;
  } while (cursor);
  return images;
}

/**
 * @param {{ apply: boolean, limit?: number, api?: object, log?: Function }} options
 * @returns {Promise<{ total: number, misplaced: number, moved: number, left: number, stoppedByLimit: boolean }>}
 */
async function organize({ apply, limit = PER_RUN, api = cloudinary.api, log = console.log }) {
  const images = await listImages(api);
  const misplaced = images.filter((image) => image.target && image.current !== image.target);

  const byFolder = {};
  for (const image of misplaced) byFolder[image.target] = (byFolder[image.target] || 0) + 1;

  log("========= CLOUDINARY FOLDERS =========");
  log(`Kreedum images        : ${images.length}`);
  log(`Already in their folder: ${images.length - misplaced.length}`);
  log(`To move               : ${misplaced.length}`);
  for (const [folder, count] of Object.entries(byFolder)) log(`  → ${folder}: ${count}`);

  if (!apply || !misplaced.length) {
    if (!misplaced.length) log("✅ Every image is in its folder.");
    else log("Dry run — nothing moved. Run again with --apply.");
    return { total: images.length, misplaced: misplaced.length, moved: 0, left: misplaced.length, stoppedByLimit: false };
  }

  let moved = 0;
  let stoppedByLimit = false;
  let failed = 0;
  for (const image of misplaced.slice(0, limit)) {
    try {
      const result = await api.update(image.publicId, { asset_folder: image.target });
      moved++;
      if (moved % 50 === 0) log(`  moved ${moved}…`);
      if (typeof result?.rate_limit_remaining === "number" && result.rate_limit_remaining <= SPARE) {
        stoppedByLimit = true;
        break;
      }
    } catch (error) {
      if (isRateLimit(error)) {
        stoppedByLimit = true;
        break;
      }
      failed++;
      log(`  ⚠️ ${image.publicId}: ${errorMessage(error)}`);
      // Something else is wrong (not one bad image): stop instead of repeating it.
      if (failed >= 5 && failed > moved) {
        log("  Stopping: the same problem keeps happening. Check the message above.");
        break;
      }
    }
  }

  const left = misplaced.length - moved;
  log(`Moved now             : ${moved}`);
  if (left) {
    log(`Still to move         : ${left}`);
    log(`⏳ ${stoppedByLimit ? "Cloudinary's hourly limit reached." : `This run moves up to ${limit}.`} Run it again in an hour.`);
  } else {
    log("✅ Every image is in its folder.");
  }
  return { total: images.length, misplaced: misplaced.length, moved, left, stoppedByLimit };
}

async function main() {
  const apply = process.argv.includes("--apply");
  checkCloudinaryUrl();
  await organize({ apply, limit: Number(option("--limit")) || PER_RUN });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("❌", isRateLimit(error) ? "Cloudinary's hourly limit is reached. Try again in an hour." : errorMessage(error));
    process.exit(1);
  });
}

module.exports = { organize, listImages };
