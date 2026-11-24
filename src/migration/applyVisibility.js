/**
 * Hide products whose category or brand is hidden in the admin, and show
 * again those hidden only because of a category / brand that's on now.
 * The admin does this by itself when a category or brand is switched; run
 * this once for categories hidden before that, or to check everything.
 *
 *   npm run visibility:apply              dry run: shows what would change
 *   npm run visibility:apply -- --apply   makes the changes
 *
 * Products switched off on their own page are never switched on.
 */
require("../config/bootstrap");

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const { refreshVisibility } = require("../utils/productVisibility");

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDatabase();
  const { hidden, shown, changes } = await refreshVisibility({}, { dryRun: !apply });

  console.log(`${hidden} product(s) to hide, ${shown} to show again, ${changes.length} change(s) in all.`);
  for (const c of changes.slice(0, 40)) console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
  if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

  console.log(apply ? "Done. Product counts updated." : "Dry run — nothing changed. Run again with: npm run visibility:apply -- --apply");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
