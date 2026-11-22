/**
 * Categories changed in the admin dashboard, kept by the catalogue rebuild
 * (npm run rebuild:catalog):
 *
 *   - categories created in the admin (addedBy "admin") are added to the tree,
 *     under their parent, so products can be placed in them. Metro doesn't
 *     have them, but they're never deleted by the rebuild.
 *   - edits to any category (name, menu order, shown / hidden) are listed in
 *     category.adminLocked and kept, like product edits.
 */

// Category fields the admin can change (and lock).
const CATEGORY_LOCKABLE = ["name", "displayOrder", "isActive"];

/**
 * @param {Array} categories          the tree (Metro's menu + categoryRules.js)
 * @param {Array} existingCategories  KreedumCommerce.categories now
 * @returns {{ categories: Array, problems: string[] }}
 */
function withAdminCategories(categories, existingCategories = []) {
  const result = categories.map((c) => ({ ...c }));
  const bySlug = new Map(result.map((c) => [c.slug, c]));
  const problems = [];

  // Admin-made categories, parents first (a new sub-category of a new category).
  const adminMade = existingCategories
    .filter((c) => c.addedBy === "admin" && !bySlug.has(c.slug))
    .sort((a, b) => (a.level || 1) - (b.level || 1));
  for (const c of adminMade) {
    const parent = c.parentSlug ? bySlug.get(c.parentSlug) : null;
    if (c.parentSlug && !parent) {
      problems.push(`Admin category "${c.slug}": its parent "${c.parentSlug}" no longer exists, so it's left out`);
      continue;
    }
    const doc = {
      name: c.name,
      slug: c.slug,
      level: parent ? parent.level + 1 : 1,
      parentSlug: parent ? parent.slug : undefined,
      rootSlug: parent ? parent.rootSlug || parent.path[0] : c.slug,
      path: parent ? [...parent.path, c.slug] : [c.slug],
      displayOrder: c.displayOrder || 0,
      supplierCategories: [],
      isActive: c.isActive !== false,
      addedBy: "admin",
      adminLocked: c.adminLocked || [],
    };
    if (doc.level > 3) {
      problems.push(`Admin category "${c.slug}" would be level ${doc.level} (max 3), so it's left out`);
      continue;
    }
    if (!doc.parentSlug) delete doc.parentSlug;
    result.push(doc);
    bySlug.set(doc.slug, doc);
  }

  // Locked edits on any category.
  const existingBySlug = new Map(existingCategories.map((c) => [c.slug, c]));
  for (const c of result) {
    const existing = existingBySlug.get(c.slug);
    for (const field of existing?.adminLocked || []) {
      if (CATEGORY_LOCKABLE.includes(field) && existing[field] !== undefined) c[field] = existing[field];
    }
    if (existing?.adminLocked?.length) c.adminLocked = existing.adminLocked;
  }
  return { categories: result, problems };
}

module.exports = { withAdminCategories, CATEGORY_LOCKABLE };
