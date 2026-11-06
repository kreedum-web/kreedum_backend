/**
 * Brand rules for the website. Edit this file to change them, then run
 *   npm run brands:apply             (dry run: shows what would change)
 *   npm run brands:apply -- --apply  (changes the live database)
 * The catalogue rebuild (npm run rebuild:catalog) follows the same rules, so
 * a rebuild never undoes them.
 */
module.exports = {
  // Kept in the database but not shown on the website (not partners yet).
  // To show a brand again, remove it here and run brands:apply.
  // Use the brand's slug: lowercase, spaces → "-".
  hiddenBrands: ["powermax-fitness", "zorex-fitness","concept2"],

  // Products sold under our own name. "inCategories" limits a rule to products
  // whose category path has a slug containing one of these words.
  renamedBrands: [
    {
      from: "everise-fitness",
      to: "Kreedum",
      inCategories: ["outdoor"],
      // The old name as it appears in product names and descriptions.
      oldWords: ["everise fitness", "everise"],
    },
  ],
};
