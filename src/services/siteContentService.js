const HeroBanner = require("../models/HeroBanner");
const Announcement = require("../models/Announcement");
const Leader = require("../models/Leader");
const Client = require("../models/Client");
const defaults = require("../data/defaultSiteContent");

const ORDER = { displayOrder: 1, createdAt: 1 };

/**
 * Site content the owner manages (banners, announcements, leaders, clients).
 *
 * A section never set up in the database returns `null` (the website then
 * shows its built-in content). Once it exists, only active entries are
 * returned, so switching everything off really hides the section.
 */
class SiteContentService {
  /** Active hero / offer banners, within their start and end dates. */
  async getHeroBanners(now = new Date()) {
    const total = await HeroBanner.countDocuments({});
    if (!total) {
      // Not set up yet: the original banners (the website supplies the photos).
      return defaults.heroBanners.map(({ file, ...banner }, index) => ({ id: index + 1, ...banner, image: "" }));
    }

    const banners = await HeroBanner.find({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort(ORDER)
      .lean();

    return banners.map((banner) => ({
      id: String(banner._id),
      title: banner.title,
      subtitle: banner.subtitle,
      image: banner.image,
      buttonText: banner.buttonText,
      buttonLink: banner.buttonLink,
    }));
  }

  async getSiteContent() {
    const [announcements, leaders, clients] = await Promise.all([
      this.#activeOrNull(Announcement, (a) => ({ id: String(a._id), text: a.text, link: a.link })),
      this.#activeOrNull(Leader, (l) => ({ id: String(l._id), name: l.name, role: l.role, quote: l.quote, image: l.image })),
      this.#activeOrNull(Client, (c) => ({ id: String(c._id), name: c.name, image: c.image })),
    ]);
    return { announcements, leaders, clients };
  }

  async #activeOrNull(Model, shape) {
    const total = await Model.countDocuments({});
    if (!total) return null;
    const rows = await Model.find({ isActive: true }).sort(ORDER).lean();
    return rows.map(shape);
  }
}

module.exports = new SiteContentService();
