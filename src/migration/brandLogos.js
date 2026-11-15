/**
 * Brand logos → Cloudinary (folder kreedum/brands) → the brand's "logo" in
 * the database. The website shows that logo on the Brands page and in the
 * mobile menu; a brand without one shows its name instead.
 *
 * 1. Put the logo files in the brand-logos folder of this repo, named after
 *    the brand: aerofit.png, xpeed.svg, "Vector X.png" … (PNG / JPG / WEBP /
 *    SVG; transparent or white background; about 600 × 300 px is plenty).
 * 2. npm run brands:logos              dry run: shows which file goes to which brand
 *    npm run brands:logos -- --apply   uploads them and saves the addresses
 *
 * Options:  --dir <folder>   logos somewhere else
 *           --only <slug>    just one brand, e.g. --only aerofit
 *
 * A new file for a brand replaces its old logo (same Cloudinary name).
 * Needs CLOUDINARY_URL in .env.
 */
require("../config/bootstrap");

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const connectDatabase = require("../config/database");
const Brand = require("../models/Brand");
const { checkCloudinaryUrl, fileName, uploadImage } = require("../utils/cloudinaryFolders");

const IMAGE = /\.(png|jpe?g|webp|svg|avif)$/i;

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

/** "Vector X.png" → "vector-x": the same shape as brand slugs. */
const slugOfFile = (file) => fileName(path.basename(file).replace(IMAGE, ""));

/**
 * Which logo file goes with which brand.
 * @returns {{ matches: {brand, file}[], unknownFiles: string[], withoutLogo: object[] }}
 */
function planLogos(brands, files, { only } = {}) {
  const bySlug = new Map(brands.map((brand) => [brand.slug, brand]));
  const byName = new Map(brands.map((brand) => [fileName(brand.name), brand]));
  const matches = [];
  const unknownFiles = [];

  for (const file of files.filter((f) => IMAGE.test(f)).sort()) {
    const key = slugOfFile(file);
    const brand = bySlug.get(key) || byName.get(key);
    if (!brand) unknownFiles.push(file);
    else if (!only || brand.slug === only) matches.push({ brand, file });
  }

  const covered = new Set(matches.map((m) => m.brand.slug));
  const withoutLogo = brands.filter((b) => b.isActive !== false && !b.logo && !covered.has(b.slug));
  return { matches, unknownFiles, withoutLogo };
}

/**
 * @param {{ apply: boolean, dir: string, only?: string, upload?: Function }} options
 *   upload: replaces the Cloudinary upload (tests)
 */
async function run({ apply, dir, only, upload = uploadImage }) {
  const lines = [];
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}. Put the logo files there (see the top of this file).`);

  const brands = await Brand.find({}).sort({ name: 1 }).lean();
  const { matches, unknownFiles, withoutLogo } = planLogos(brands, fs.readdirSync(dir), { only });

  for (const { brand, file } of matches) {
    if (!apply) {
      lines.push(`would upload  ${file.padEnd(28)} → ${brand.name}${brand.logo ? " (replaces its logo)" : ""}`);
      continue;
    }
    const image = await upload(path.join(dir, file), { kind: "brands", name: brand.slug, overwrite: true });
    await Brand.updateOne({ _id: brand._id }, { $set: { logo: image.url, logoPublicId: image.publicId } });
    lines.push(`✅ ${brand.name.padEnd(20)} ${image.url}`);
  }

  if (!matches.length) lines.push("No logo files matched a brand.");
  unknownFiles.forEach((file) => lines.push(`⚠️  ${file}: no brand called "${slugOfFile(file)}" — rename it to the brand's slug`));
  if (withoutLogo.length) {
    lines.push(`Brands still without a logo: ${withoutLogo.map((b) => `${b.name} (${b.slug})`).join(", ")}`);
  }
  return lines;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dir = path.resolve(option("--dir") || path.join(__dirname, "../../brand-logos"));
  const only = option("--only");

  if (apply) checkCloudinaryUrl();
  await connectDatabase();

  console.log("=========== BRAND LOGOS ===========");
  console.log(`Logos from: ${dir}`);
  (await run({ apply, dir, only })).forEach((line) => console.log(line));
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

module.exports = { planLogos, run, slugOfFile };
