const generateSlug = require("./generateSlug");
const RULES = require("../config/brandRules");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this brand kept off the website? */
function isHiddenBrand(brandSlug, rules = RULES) {
  return rules.hiddenBrands.includes(brandSlug);
}

/** The rename rule for this brand in this category path, if any. */
function renameRuleFor(brandSlug, categoryPath = [], rules = RULES) {
  return (
    rules.renamedBrands.find(
      (rule) =>
        rule.from === brandSlug &&
        (!rule.inCategories?.length ||
          categoryPath.some((slug) => rule.inCategories.some((word) => String(slug).includes(word))))
    ) || null
  );
}

/** Replace the old brand name (any capitalisation) with the new one, in strings, lists and objects. */
function rebrand(value, rule) {
  const words = [...rule.oldWords].sort((a, b) => b.length - a.length).map(escapeRegex);
  const pattern = new RegExp(`\\b(?:${words.join("|")})\\b`, "gi");
  const walk = (item) => {
    if (typeof item === "string") return item.replace(pattern, rule.to).replace(new RegExp(`\\b(${escapeRegex(rule.to)})(\\s+\\1\\b)+`, "gi"), "$1");
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object" && !(item instanceof Date)) {
      return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, walk(val)]));
    }
    return item;
  };
  return walk(value);
}

/** A supplier (Metro) product as the website should sell it: renamed brand and text. */
function applyRenameToSupplierProduct(sp, categoryPath, rules = RULES) {
  const rule = renameRuleFor(generateSlug(String(sp.brand || "").trim()), categoryPath, rules);
  if (!rule) return sp;
  return {
    ...sp,
    brand: rule.to,
    name: rebrand(sp.name || "", rule),
    shortDescription: rebrand(sp.shortDescription || "", rule),
    descriptionHtml: rebrand(sp.descriptionHtml || "", rule),
    descriptionText: rebrand(sp.descriptionText || "", rule),
    features: rebrand(sp.features || [], rule),
  };
}

module.exports = { isHiddenBrand, renameRuleFor, rebrand, applyRenameToSupplierProduct, RULES };
