/**
 * Copy the product catalogue from the production database into the
 * development one, so the development site has real products to test with.
 *
 *   npm run db:copy-catalog              dry run: shows what would be copied
 *   npm run db:copy-catalog -- --apply   copies (replaces the development catalogue)
 *
 * Run it on your computer with a .env whose DB_NAME is the development
 * database (e.g. DB_NAME=KreedumCommerce_dev). It copies ONLY catalogue and
 * website content. Customer data (users, orders, carts, wishlists,
 * addresses, codes) is never copied, and production is only read.
 */
require("../config/bootstrap");

const mongoose = require("mongoose");
const { databaseName, PRODUCTION_DB } = require("../config/database");

const CATALOGUE = ["products", "categories", "brands", "image_assets", "hero_banners", "announcements", "leaders", "clients"];
const BATCH = 500;

async function main() {
  const apply = process.argv.includes("--apply");
  const source = (process.env.SOURCE_DB_NAME || PRODUCTION_DB).trim();
  const target = databaseName();

  if (target === source || target === PRODUCTION_DB) {
    throw new Error(
      `DB_NAME is "${target}", the production database. Set DB_NAME to the development database (e.g. KreedumCommerce_dev) in .env first.`
    );
  }

  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const from = connection.useDb(source);
  const to = connection.useDb(target);

  console.log(`========== COPY CATALOGUE ==========`);
  console.log(`From (read only): ${source}`);
  console.log(`To              : ${target}`);

  for (const name of CATALOGUE) {
    const docs = await from.collection(name).find({}).toArray();
    const existing = await to.collection(name).countDocuments();
    console.log(`  ${name.padEnd(14)} ${String(docs.length).padStart(5)} to copy   (${existing} there now)`);
    if (!apply) continue;

    await to.collection(name).deleteMany({});
    for (let i = 0; i < docs.length; i += BATCH) {
      await to.collection(name).insertMany(docs.slice(i, i + BATCH), { ordered: false });
    }
  }

  if (!apply) {
    console.log("Dry run — nothing copied. Run again with: npm run db:copy-catalog -- --apply");
  } else {
    console.log("✅ Catalogue copied. Indexes are created when the development server starts.");
  }
  await connection.close();
}

main().catch(async (error) => {
  console.error("❌", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
