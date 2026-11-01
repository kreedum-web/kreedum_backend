const mongoose = require("mongoose");

/** One message in the moving strip at the top of every page. */
const announcementSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 120 },
    link: { type: String, default: "", trim: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "announcements" }
);

module.exports = mongoose.model("Announcement", announcementSchema);
