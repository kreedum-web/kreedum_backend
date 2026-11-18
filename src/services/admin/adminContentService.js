const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");

const HeroBanner = require("../../models/HeroBanner");
const Announcement = require("../../models/Announcement");
const Leader = require("../../models/Leader");
const Client = require("../../models/Client");
const HttpError = require("../../utils/httpError");
const { uploadImage } = require("../../utils/cloudinaryFolders");

const text = (max) => (v) => String(v ?? "").trim().slice(0, max);
const date = (v) => {
  if (v === null || v === "" || v === undefined) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid date.");
  return d;
};

/**
 * Website content the owner manages from the dashboard. Each kind: its model,
 * the fields the dashboard may set, which are required, and (for kinds with
 * a picture) the Cloudinary folder kind (src/utils/cloudinaryFolders.js).
 */
const KINDS = {
  hero: {
    Model: HeroBanner,
    image: "hero",
    required: ["title"],
    fields: {
      title: text(120), subtitle: text(200), buttonText: text(40), buttonLink: text(300),
      startsAt: date, endsAt: date,
    },
  },
  announcements: {
    Model: Announcement,
    required: ["text"],
    fields: { text: text(120), link: text(300) },
  },
  leaders: {
    Model: Leader,
    image: "leaders",
    required: ["name"],
    fields: { name: text(80), role: text(80), quote: text(600) },
  },
  clients: {
    Model: Client,
    image: "clients",
    required: ["name"],
    fields: { name: text(120) },
  },
};

function kindOf(kind) {
  const config = KINDS[kind];
  if (!config) throw new HttpError(404, "Unknown content type.");
  return config;
}

function checkId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid id.");
}

const shape = (row) => ({ ...row, id: String(row._id) });

class AdminContentService {
  async list(kind) {
    const { Model } = kindOf(kind);
    const rows = await Model.find({}).sort({ displayOrder: 1, createdAt: 1 }).lean();
    return rows.map(shape);
  }

  /** body: the kind's fields + isActive, displayOrder, image (data:image/… to upload a new picture). */
  async save(kind, id, body = {}) {
    const config = kindOf(kind);
    const { Model } = config;
    let row;
    if (id) {
      checkId(id);
      row = await Model.findById(id);
      if (!row) throw new HttpError(404, "Not found.");
    } else {
      const last = await Model.findOne({}).sort({ displayOrder: -1 }).lean();
      row = new Model({ displayOrder: (last?.displayOrder ?? -1) + 1 });
    }

    for (const [field, clean] of Object.entries(config.fields)) {
      if (body[field] !== undefined) row[field] = clean(body[field]);
    }
    if (body.isActive !== undefined) row.isActive = Boolean(body.isActive);
    if (body.displayOrder !== undefined) row.displayOrder = Number(body.displayOrder) || 0;

    for (const field of config.required) {
      if (!row[field]) throw new HttpError(400, `Please fill in ${field}.`);
    }
    if (row.startsAt && row.endsAt && row.endsAt < row.startsAt) {
      throw new HttpError(400, "The end date is before the start date.");
    }

    if (config.image && body.image) {
      if (!/^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(body.image)) {
        throw new HttpError(400, "Please choose a JPG, PNG or WebP picture.");
      }
      if (body.image.length > 11 * 1024 * 1024) throw new HttpError(413, "Picture is too big (max 8 MB).");
      const oldPublicId = row.imagePublicId;
      const name = `${row.title || row.name || kind}-${Date.now()}`;
      const { url, publicId } = await uploadImage(body.image, { kind: config.image, name });
      row.image = url;
      row.imagePublicId = publicId;
      if (oldPublicId) removeImage(oldPublicId);
    }

    await row.save();
    return shape(row.toObject());
  }

  async remove(kind, id) {
    const { Model } = kindOf(kind);
    checkId(id);
    const row = await Model.findByIdAndDelete(id).lean();
    if (!row) throw new HttpError(404, "Not found.");
    if (row.imagePublicId) removeImage(row.imagePublicId);
    return { deleted: true };
  }

  /** ids in the new display order (drag & drop / up-down arrows). */
  async reorder(kind, ids = []) {
    const { Model } = kindOf(kind);
    if (!Array.isArray(ids)) throw new HttpError(400, "ids must be a list.");
    ids.forEach(checkId);
    await Model.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { displayOrder: index } } } })));
    return this.list(kind);
  }
}

/** Delete an old picture from Cloudinary, in the background (never blocks a save). */
function removeImage(publicId) {
  cloudinary.uploader.destroy(publicId).catch((error) => console.error(`Couldn't delete ${publicId}:`, error.message));
}

module.exports = new AdminContentService();
module.exports.KINDS = KINDS;
