/**
 * Copy product photos from the supplier (Metro Sports) to Kreedum's own
 * Cloudinary account, then point the catalogue at the copies.
 *
 *   npm run images:upload                         dry run: counts only, nothing uploaded
 *   npm run images:upload -- --apply --limit 20   try 20 photos first
 *   npm run images:upload -- --apply              upload everything still missing
 *
 * Needs CLOUDINARY_URL in .env (Cloudinary dashboard → Settings → API Keys →
 * "API environment variable": cloudinary://<key>:<secret>@<cloud name>).
 *
 * Safe to stop and run again: every finished upload is saved at once
 * (collection image_assets) and is never uploaded twice. Photos that fail are
 * listed in image-upload-failures.json and retried on the next run. After a
 * catalogue rebuild adds new products, run it again to copy their photos.
 */
require("../config/bootstrap");

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

const connectDatabase = require("../config/database");
const Product = require("../models/Product");
const ImageAsset = require("../models/ImageAsset");
const {
  productImageUrls,
  isOwnImage,
  assignPublicIds,
  deliveryUrl,
  withOwnImages,
} = require("../utils/productImages");

const CONCURRENCY = 4;
const RETRIES = 3;

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cloudinary downloads the photo from the supplier itself. Stored at most
 * 1600px on the long side (saves storage; customers get 1200px at most).
 * overwrite:false: a photo already there is returned as it is.
 */
async function uploadOne(sourceUrl, publicId) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await cloudinary.uploader.upload(sourceUrl, {
        public_id: publicId,
        overwrite: false,
        unique_filename: false,
        resource_type: "image",
        transformation: [{ width: 1600, height: 1600, crop: "limit" }],
      });
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await wait(1500 * attempt);
    }
  }
}

/** Point products at the uploaded copies. Returns how many changed. */
async function rewriteProducts(products, imageMap) {
  const operations = [];
  for (const product of products) {
    const updated = withOwnImages(product, imageMap);
    if (JSON.stringify(productImageUrls(updated)) === JSON.stringify(productImageUrls(product))) continue;
    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            thumbnail: updated.thumbnail,
            images: updated.images,
            ...(product.variants?.length ? { variants: updated.variants } : {}),
          },
        },
      },
    });
  }
  for (let i = 0; i < operations.length; i += 500) {
    await Product.bulkWrite(operations.slice(i, i + 500), { ordered: false });
  }
  return operations.length;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Number(option("--limit")) || Infinity;

  if (apply && !process.env.CLOUDINARY_URL) {
    throw new Error(
      "CLOUDINARY_URL is missing in .env. Copy it from Cloudinary → Settings → API Keys (\"API environment variable\")."
    );
  }

  await connectDatabase();

  const [products, assets] = await Promise.all([
    Product.find({}, { slug: 1, thumbnail: 1, images: 1, variants: 1 }).lean(),
    ImageAsset.find({}, { sourceUrl: 1, url: 1, publicId: 1 }).lean(),
  ]);

  const imageMap = new Map(assets.map((asset) => [asset.sourceUrl, asset.url]));
  const allUrls = [...new Set(products.flatMap(productImageUrls))];
  const supplierUrls = allUrls.filter((url) => !isOwnImage(url));
  const pending = supplierUrls.filter((url) => !imageMap.has(url));
  const batch = pending.slice(0, limit);

  console.log("========== PRODUCT IMAGES ==========");
  console.log(`Products                     : ${products.length}`);
  console.log(`Photos used by products      : ${allUrls.length}`);
  console.log(`Already in Cloudinary        : ${allUrls.length - pending.length}`);
  console.log(`Still on the supplier's site : ${pending.length}`);

  if (!apply) {
    console.log("Dry run — nothing uploaded. Try a few first with: npm run images:upload -- --apply --limit 20");
    await mongoose.disconnect();
    return;
  }

  // ---------- upload
  const publicIds = assignPublicIds(batch, new Map(assets.map((asset) => [asset.publicId, asset.sourceUrl])));
  const failures = [];
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < batch.length) {
      const sourceUrl = batch[next++];
      try {
        const result = await uploadOne(sourceUrl, publicIds.get(sourceUrl));
        const url = deliveryUrl(result.secure_url);
        await ImageAsset.updateOne(
          { sourceUrl },
          {
            $set: {
              sourceUrl,
              url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              bytes: result.bytes,
            },
          },
          { upsert: true }
        );
        imageMap.set(sourceUrl, url);
      } catch (error) {
        failures.push({ sourceUrl, error: error?.error?.message || error.message });
      }
      done++;
      if (done % 50 === 0 || done === batch.length) {
        console.log(`  uploaded ${done - failures.length}/${batch.length}${failures.length ? ` (${failures.length} failed)` : ""}`);
      }
    }
  }

  console.log(`Uploading ${batch.length} photos…`);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));

  // ---------- point products at the copies
  const changed = await rewriteProducts(products, imageMap);

  console.log("============== DONE ==============");
  console.log(`Uploaded now                 : ${batch.length - failures.length}`);
  console.log(`Failed (retried next run)    : ${failures.length}`);
  console.log(`Products updated             : ${changed}`);
  console.log(`Still on the supplier's site : ${pending.length - (batch.length - failures.length)}`);

  const failuresFile = path.resolve("image-upload-failures.json");
  if (failures.length) {
    fs.writeFileSync(failuresFile, JSON.stringify(failures, null, 2));
    console.log(`📝 Failed photos listed in ${failuresFile}`);
  } else if (fs.existsSync(failuresFile)) {
    fs.unlinkSync(failuresFile);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("❌", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { main, rewriteProducts, uploadOne };
