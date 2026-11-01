/**
 * Move the website's built-in content into the database, with its images in
 * Cloudinary folders:
 *
 *   hero banners  -> hero_banners   images: kreedum/homepage/hero
 *   announcements -> announcements  (text only)
 *   leaders       -> leaders        images: kreedum/leaders
 *   clients       -> clients        images: kreedum/clients
 *
 *   npm run content:seed                       dry run: shows what it would do
 *   npm run content:seed -- --apply            upload images + create the content
 *   npm run content:seed -- --apply --images ../kreedum_frontend/public/images
 *
 * --images: folder holding the current images (default: the frontend repo next
 * to this one). A section that already has content in the database is left
 * alone, so running it again never overwrites changes made later.
 * Needs CLOUDINARY_URL in .env.
 */
require("../config/bootstrap");

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const connectDatabase = require("../config/database");
const HeroBanner = require("../models/HeroBanner");
const Announcement = require("../models/Announcement");
const Leader = require("../models/Leader");
const Client = require("../models/Client");
const defaults = require("../data/defaultSiteContent");
const { KINDS, checkCloudinaryUrl, uploadImage } = require("../utils/cloudinaryFolders");

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const SECTIONS = [
  {
    label: "Hero banners",
    Model: HeroBanner,
    kind: "hero",
    items: defaults.heroBanners,
    imageName: (item) => item.title,
    toDoc: ({ file, ...item }, image) => ({ ...item, image: image.url, imagePublicId: image.publicId }),
  },
  {
    label: "Announcements",
    Model: Announcement,
    items: defaults.announcements,
    toDoc: (item) => item,
  },
  {
    label: "Leaders",
    Model: Leader,
    kind: "leaders",
    items: defaults.leaders,
    imageName: (item) => item.name,
    toDoc: ({ file, ...item }, image) => ({ ...item, image: image.url, imagePublicId: image.publicId }),
  },
  {
    label: "Clients",
    Model: Client,
    kind: "clients",
    items: defaults.clients,
    imageName: (item) => item.name,
    toDoc: ({ file, ...item }, image) => ({ ...item, image: image.url, imagePublicId: image.publicId }),
  },
];

/**
 * @param {{ apply: boolean, imagesDir: string, upload?: Function }} options
 *   upload: replaces the Cloudinary upload (tests)
 */
async function seed({ apply, imagesDir, upload = uploadImage }) {
  const summary = [];

  for (const section of SECTIONS) {
    const existing = await section.Model.countDocuments({});
    if (existing) {
      summary.push(`${section.label.padEnd(14)} already set up (${existing}) — left as it is`);
      continue;
    }

    // Every image must be there before anything is uploaded.
    const missing = section.kind
      ? section.items.filter((item) => !fs.existsSync(path.join(imagesDir, item.file))).map((item) => item.file)
      : [];
    if (missing.length) {
      summary.push(`${section.label.padEnd(14)} ❌ images not found in ${imagesDir}: ${missing.join(", ")}`);
      continue;
    }

    if (!apply) {
      const where = section.kind ? ` → Cloudinary ${KINDS[section.kind].folder}` : "";
      summary.push(`${section.label.padEnd(14)} would add ${section.items.length}${where}`);
      continue;
    }

    const docs = [];
    for (const [index, item] of section.items.entries()) {
      const image = section.kind
        ? await upload(path.join(imagesDir, item.file), { kind: section.kind, name: section.imageName(item), overwrite: true })
        : null;
      docs.push({ ...section.toDoc(item, image), displayOrder: index, isActive: true });
    }
    await section.Model.insertMany(docs);
    summary.push(`${section.label.padEnd(14)} ✅ added ${docs.length}${section.kind ? ` (images in ${KINDS[section.kind].folder})` : ""}`);
  }

  return summary;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const imagesDir = path.resolve(option("--images") || path.join(__dirname, "../../../kreedum_frontend/public/images"));

  if (apply) checkCloudinaryUrl();
  await connectDatabase();

  console.log("=========== SITE CONTENT ===========");
  console.log(`Images from: ${imagesDir}`);
  const summary = await seed({ apply, imagesDir });
  summary.forEach((line) => console.log(line));
  if (!apply) console.log("Dry run — nothing uploaded or saved. Run again with --apply.");

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error("❌", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { seed, SECTIONS };
