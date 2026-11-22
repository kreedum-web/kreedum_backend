/**
 * Category rules for the website: our own tweaks on top of Metro Sports'
 * menu. Edit this file to change them, then run
 *   npm run categories:apply             (dry run: shows what would change)
 *   npm run categories:apply -- --apply  (changes the live database)
 * The catalogue rebuild (npm run rebuild:catalog) follows the same rules, so
 * a rebuild never undoes them.
 *
 * Slugs are the category's web address name: lowercase, spaces → "-"
 * (e.g. /category/boxing-and-punching-bags).
 */
module.exports = {
  // Show a category under a different name (its web address stays the same).
  renamedCategories: [{ slug: "home-gym", name: "Multi Gym" }],

  // Categories Metro doesn't have. "parent" is an existing category's slug,
  // or null for a new top-level department. Order = order in the menu.
  newCategories: [
    { slug: "punching-bags", name: "Punching Bags", parent: "boxing-and-punching-bags" },
    { slug: "boxing-mma-gloves", name: "Boxing & MMA Gloves", parent: "boxing-and-punching-bags" },
    { slug: "guards-and-pads", name: "Guards & Pads", parent: "boxing-and-punching-bags" },
    { slug: "speed-balls", name: "Speed Balls", parent: "boxing-and-punching-bags" },
    { slug: "grappling-dummies", name: "Grappling Dummies", parent: "boxing-and-punching-bags" },
    { slug: "gym-gloves", name: "Gym Gloves", parent: "accessories" },
    // For Aerofit / Cockatoo products (scraper catalog_feed), decided 21 Nov 2026.
    { slug: "swimming", name: "Swimming", parent: "sports" },
    { slug: "badminton", name: "Badminton", parent: "sports" },
    { slug: "cricket", name: "Cricket", parent: "sports" },
    { slug: "other-sports", name: "Other Sports", parent: "sports" },
    { slug: "shoes", name: "Shoes", parent: null },
    // Added 22 Nov 2026
    { slug: "walking-pads", name: "Walking Pads", parent: "cardio" },
    { slug: "home-gym-sets", name: "Home Gym Sets", parent: "weights-bars" },
  ],

  // Move products by words in their name. Only products currently anywhere
  // under "from" are checked; the first rule that matches wins, so put the
  // more specific rules first. Products no rule matches stay where they are
  // (the dry run lists them).
  productMoves: [
    // Metro lists walking pads under Domestic Treadmill.
    { from: "domestic-treadmill", to: "walking-pads", words: ["walking pad", "walkpad", "walk pad"] },
    // Weightlifting gloves aren't boxing gear.
    { from: "boxing-and-punching-bags", to: "gym-gloves", words: ["weightlifting glove", "weight lifting glove", "air vent glove"] },
    {
      from: "boxing-and-punching-bags",
      to: "guards-and-pads",
      words: ["head guard", "headguard", "shin guard", "shinguard", "focus pad", "target pad", "square pad", "round pad"],
    },
    { from: "boxing-and-punching-bags", to: "grappling-dummies", words: ["grappling", "dummy"] },
    { from: "boxing-and-punching-bags", to: "boxing-mma-gloves", words: ["glove"] },
    { from: "boxing-and-punching-bags", to: "speed-balls", words: ["speedball", "speed ball", "punching ball", "rotabar"] },
    { from: "boxing-and-punching-bags", to: "boxing-stand", words: ["bracket", "double station", "punch stand"] },
    {
      from: "boxing-and-punching-bags",
      to: "punching-bags",
      words: ["bag", "boxing man", "boxing trainer", "kick bag"],
    },
  ],
};
