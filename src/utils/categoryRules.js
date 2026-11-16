const RULES = require("../config/categoryRules");

/**
 * Metro's category list with our rules applied (src/config/categoryRules.js):
 * renamed categories get their new name, new categories are added under their
 * parent (level, path and menu order worked out from it).
 *
 * @param categories  category docs: { name, slug, level, parentSlug, rootSlug, path, displayOrder, ... }
 * @returns { categories, problems: string[] }  problems: rules that couldn't be used
 */
function withCategoryRules(categories, rules = RULES) {
  const problems = [];
  const renamed = new Map(rules.renamedCategories.map((rule) => [rule.slug, rule.name]));
  const result = categories.map((c) => (renamed.has(c.slug) ? { ...c, name: renamed.get(c.slug) } : c));
  const bySlug = new Map(result.map((c) => [c.slug, c]));

  for (const slug of renamed.keys()) {
    if (!bySlug.has(slug)) problems.push(`renamedCategories: no category "${slug}"`);
  }

  // New categories go after the parent's existing ones, in the order listed.
  const nextOrder = new Map();
  const orderUnder = (parentSlug) => {
    if (!nextOrder.has(parentSlug)) {
      const metro = result.filter((c) => c.parentSlug === parentSlug).map((c) => c.displayOrder || 0);
      nextOrder.set(parentSlug, Math.max(0, ...metro) + 1);
    }
    const order = nextOrder.get(parentSlug);
    nextOrder.set(parentSlug, order + 1);
    return order;
  };

  for (const rule of rules.newCategories) {
    if (bySlug.has(rule.slug)) continue; // Metro has it now: keep theirs
    const parent = bySlug.get(rule.parent);
    if (!parent) {
      problems.push(`newCategories: "${rule.slug}" — no parent category "${rule.parent}"`);
      continue;
    }
    if (parent.level >= 3) {
      problems.push(`newCategories: "${rule.slug}" — "${rule.parent}" is already 3 levels deep`);
      continue;
    }
    const doc = {
      name: rule.name,
      slug: rule.slug,
      level: parent.level + 1,
      parentSlug: parent.slug,
      rootSlug: parent.rootSlug || parent.path?.[0] || parent.slug,
      path: [...(parent.path || [parent.slug]), rule.slug],
      displayOrder: orderUnder(parent.slug),
      supplierCategories: [],
      isActive: true,
      addedBy: "category-rule",
    };
    result.push(doc);
    bySlug.set(doc.slug, doc);
  }

  for (const rule of rules.productMoves) {
    if (!bySlug.has(rule.from)) problems.push(`productMoves: no category "${rule.from}"`);
    if (!bySlug.has(rule.to)) problems.push(`productMoves: no category "${rule.to}"`);
  }

  return { categories: result, problems };
}

/**
 * Where a product goes under the move rules: the new category path, or null
 * when no rule applies (it stays where it is).
 *
 * @param product  { name, categoryPath }
 * @param tree     Map slug -> category (with path), after withCategoryRules
 */
function movedCategoryPath(product, tree, rules = RULES) {
  const path = product.categoryPath || [];
  const name = String(product.name || "").toLowerCase();

  for (const rule of rules.productMoves) {
    if (!path.includes(rule.from)) continue;
    if (!rule.words.some((word) => name.includes(word.toLowerCase()))) continue;
    const target = tree.get(rule.to);
    if (!target?.path?.length) return null;
    return target.path.join("/") === path.join("/") ? null : [...target.path];
  }
  return null;
}

/** Products still sitting right in a "from" category that no rule matched (for the dry run). */
function unmatchedProducts(products, rules = RULES) {
  const froms = new Set(rules.productMoves.map((rule) => rule.from));
  return products.filter((p) => {
    const path = p.categoryPath || [];
    return froms.has(path.at(-1));
  });
}

module.exports = { withCategoryRules, movedCategoryPath, unmatchedProducts, RULES };
