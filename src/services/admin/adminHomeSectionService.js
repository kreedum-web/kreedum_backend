const HomeSection = require("../../models/HomeSection");
const Product = require("../../models/Product");
const Category = require("../../models/Category");
const HttpError = require("../../utils/httpError");
const generateSlug = require("../../utils/generateSlug");
const { PICK_FIELD, ensureBuiltins, previewSection, clearCache, isShowing, isObjectId } = require("../homeSectionsService");

/**
 * Admin: the home page's product rows. Built-in rows (Featured, Best
 * Sellers…) can be renamed, hidden, resized and moved; custom rows (e.g.
 * "Summer Season") can also be deleted and have dates and fill rules.
 * Picks: for built-in rows they're the product ticks (Featured, Ready
 * stock…), for Today's Deals and custom rows a list of products.
 */

const SORTS = ["popular", "newest", "discount", "price_low", "price_high"];

const text = (value, max, label) => {
  const v = String(value ?? "").trim();
  if (v.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return v;
};
const numberOrNull = (value, label) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a number of 0 or more.`);
  return n;
};
const dateOrNull = (value, label) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} is not a valid date.`);
  return d;
};

function item(s, pickCount, now = new Date()) {
  return {
    id: String(s._id),
    key: s.key,
    rule: s.rule,
    builtIn: s.rule !== "custom",
    title: s.title,
    subtitle: s.subtitle || "",
    isVisible: s.isVisible !== false,
    showingNow: isShowing(s, now),
    displayOrder: s.displayOrder || 0,
    limit: s.limit || 8,
    pickCount,
    picksAreTicks: Boolean(PICK_FIELD[s.rule]),
    autoFill: s.autoFill !== false,
    filters: {
      categorySlug: s.filters?.categorySlug || "",
      brandSlugs: s.filters?.brandSlugs || [],
      minPrice: s.filters?.minPrice ?? null,
      maxPrice: s.filters?.maxPrice ?? null,
      minDiscount: s.filters?.minDiscount ?? null,
      readyStockOnly: Boolean(s.filters?.readyStockOnly),
      sort: s.filters?.sort || "popular",
    },
    startsAt: s.startsAt || null,
    endsAt: s.endsAt || null,
  };
}

class AdminHomeSectionService {
  /** Every row, in home page order, with how many products are picked. */
  async list() {
    await ensureBuiltins();
    const sections = await HomeSection.find({}).sort({ displayOrder: 1, createdAt: 1 }).lean();
    const tickCounts = await Promise.all(
      sections.map((s) => (PICK_FIELD[s.rule] ? Product.countDocuments({ [PICK_FIELD[s.rule]]: true }) : null))
    );
    return sections.map((s, i) => item(s, tickCounts[i] ?? (s.productIds || []).length));
  }

  async #find(id) {
    if (!isObjectId(id)) throw new HttpError(400, "Invalid section id.");
    const section = await HomeSection.findById(id);
    if (!section) throw new HttpError(404, "Section not found.");
    return section;
  }

  async #one(id) {
    return (await this.list()).find((s) => s.id === String(id));
  }

  /** A new custom row, e.g. { title: "Summer Season", filters: { categorySlug: "swimming" } } */
  async create(body = {}) {
    const title = text(body.title, 80, "Title");
    if (title.length < 2) throw new HttpError(400, "Give the section a title.");
    const base = generateSlug(title) || "section";
    let key = base;
    for (let n = 2; await HomeSection.exists({ key }); n++) key = `${base}-${n}`;
    const last = await HomeSection.findOne({}).sort({ displayOrder: -1 }).lean();
    const section = await HomeSection.create({
      key,
      rule: "custom",
      title,
      displayOrder: (last?.displayOrder || 0) + 10,
      isVisible: false, // shown once it's set up
    });
    await this.update(String(section._id), { ...body, title });
    return this.#one(section._id);
  }

  /**
   * Change a row: title, subtitle, isVisible, limit, startsAt, endsAt,
   * and for custom rows autoFill and filters.
   */
  async update(id, body = {}) {
    const section = await this.#find(id);
    if (body.title !== undefined) {
      const title = text(body.title, 80, "Title");
      if (title.length < 2) throw new HttpError(400, "Give the section a title.");
      section.title = title;
    }
    if (body.subtitle !== undefined) section.subtitle = text(body.subtitle, 160, "Subtitle");
    if (body.isVisible !== undefined) section.isVisible = Boolean(body.isVisible);
    if (body.limit !== undefined) {
      const limit = Number(body.limit);
      if (!Number.isInteger(limit) || limit < 4 || limit > 16) throw new HttpError(400, "Show 4 to 16 products.");
      section.limit = limit;
    }
    if (body.startsAt !== undefined) section.startsAt = dateOrNull(body.startsAt, "Start date");
    if (body.endsAt !== undefined) section.endsAt = dateOrNull(body.endsAt, "End date");
    if (section.startsAt && section.endsAt && section.endsAt < section.startsAt) {
      throw new HttpError(400, "The end date is before the start date.");
    }

    if (section.rule === "custom") {
      if (body.autoFill !== undefined) section.autoFill = Boolean(body.autoFill);
      if (body.filters !== undefined) {
        const f = body.filters || {};
        const categorySlug = String(f.categorySlug || "").trim();
        if (categorySlug && !(await Category.exists({ slug: categorySlug }))) throw new HttpError(400, "That category doesn't exist.");
        const sort = f.sort || "popular";
        if (!SORTS.includes(sort)) throw new HttpError(400, "Unknown sort.");
        const minPrice = numberOrNull(f.minPrice, "Min price");
        const maxPrice = numberOrNull(f.maxPrice, "Max price");
        if (minPrice != null && maxPrice != null && maxPrice < minPrice) throw new HttpError(400, "Max price is below min price.");
        section.filters = {
          categorySlug,
          brandSlugs: [...new Set((Array.isArray(f.brandSlugs) ? f.brandSlugs : []).map((b) => String(b).trim()).filter(Boolean))].slice(0, 20),
          minPrice,
          maxPrice,
          minDiscount: numberOrNull(f.minDiscount, "Min discount"),
          readyStockOnly: Boolean(f.readyStockOnly),
          sort,
        };
      }
    }
    await section.save();
    clearCache();
    return this.#one(section._id);
  }

  /** Delete a custom row (built-in rows can only be hidden). */
  async remove(id) {
    const section = await this.#find(id);
    if (section.rule !== "custom") throw new HttpError(400, "Built-in sections can't be deleted. Hide it instead.");
    await HomeSection.deleteOne({ _id: section._id });
    clearCache();
    return { deleted: true };
  }

  /** New order of the rows: { ids: [id, id, …] } top to bottom. */
  async reorder(ids = []) {
    if (!Array.isArray(ids) || !ids.every(isObjectId)) throw new HttpError(400, "Send the section ids in order.");
    await HomeSection.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { displayOrder: (i + 1) * 10 } } } })));
    clearCache();
    return this.list();
  }

  /** The picked products of a row, in order. */
  async picks(id) {
    const section = await this.#find(id);
    const field = PICK_FIELD[section.rule];
    const fields = { name: 1, slug: 1, brand: 1, thumbnail: 1, images: { $slice: 1 }, sellingPrice: 1, isActive: 1, visibility: 1, displayOrder: 1 };
    const products = field
      ? await Product.find({ [field]: true }, fields).sort({ displayOrder: 1, name: 1 }).lean()
      : await Product.find({ _id: { $in: section.productIds } }, fields).lean().then((found) => {
          const byId = new Map(found.map((p) => [String(p._id), p]));
          return section.productIds.map((pid) => byId.get(String(pid))).filter(Boolean);
        });
    return products.map((p) => ({
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      thumbnail: p.thumbnail || p.images?.[0] || "",
      sellingPrice: p.sellingPrice,
      live: p.isActive !== false && p.visibility === "published",
    }));
  }

  /**
   * Set a row's picks: { productIds: [...] } in order. For built-in rows
   * this ticks those products (Featured, Ready stock…) and unticks the rest.
   */
  async setPicks(id, productIds = []) {
    const section = await this.#find(id);
    if (!Array.isArray(productIds) || !productIds.every(isObjectId)) throw new HttpError(400, "Send a list of product ids.");
    const ids = [...new Set(productIds.map(String))].slice(0, 200);
    const found = new Set((await Product.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((p) => String(p._id)));
    const valid = ids.filter((pid) => found.has(pid));

    const field = PICK_FIELD[section.rule];
    if (field) {
      await Product.updateMany({ [field]: true, _id: { $nin: valid } }, { $set: { [field]: false } });
      if (valid.length) {
        await Product.bulkWrite(
          valid.map((pid, i) => ({ updateOne: { filter: { _id: pid }, update: { $set: { [field]: true, displayOrder: i + 1 } } } }))
        );
      }
    } else {
      section.productIds = valid;
      await section.save();
    }
    clearCache();
    return this.picks(id);
  }

  /** What the row shows now: picks first, then its rule (marked picked: false). */
  async preview(id) {
    const section = await this.#find(id);
    return previewSection(section.toObject());
  }
}

module.exports = new AdminHomeSectionService();
