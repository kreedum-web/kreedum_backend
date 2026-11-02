const User = require("../models/User");

/**
 * Sign-up only asks for an email (or Google), so a new account has no name
 * or phone. The first delivery address gives us both: copy them onto the
 * account if it doesn't have them yet. Never throws.
 */
async function fillProfileFromAddress(userId, address) {
  try {
    if (!address) return false;
    const user = await User.findById(userId);
    if (!user) return false;

    let changed = false;
    const fullName = String(address.fullName || "").trim();
    if (!user.firstName && fullName) {
      const [first, ...rest] = fullName.split(/\s+/);
      user.firstName = first;
      if (!user.lastName) user.lastName = rest.join(" ");
      changed = true;
    }

    const phone = String(address.phone || "").replace(/\D/g, "").slice(-10);
    if (!user.phone && /^[6-9]\d{9}$/.test(phone)) {
      const taken = await User.findOne({ phone, _id: { $ne: user._id } });
      if (!taken) {
        user.phone = phone;
        changed = true;
      }
    }

    if (changed) await user.save();
    return changed;
  } catch (error) {
    console.error("Couldn't copy name/phone from the address:", error.message);
    return false;
  }
}

module.exports = { fillProfileFromAddress };
