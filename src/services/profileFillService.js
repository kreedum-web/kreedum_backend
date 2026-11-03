const User = require("../models/User");

/**
 * Sign-up only asks for an email, Google or a phone number, so a new account
 * may have no name, phone or email. The order fills the gaps: name and phone
 * from the delivery address, and for phone-only accounts the email typed at
 * checkout (kept as contactEmail, for order emails only). Never throws.
 */
async function fillProfileFromAddress(userId, address, { contactEmail } = {}) {
  try {
    const user = await User.findById(userId);
    if (!user) return false;

    let changed = false;
    const fullName = String(address?.fullName || "").trim();
    if (!user.firstName && fullName) {
      const [first, ...rest] = fullName.split(/\s+/);
      user.firstName = first;
      if (!user.lastName) user.lastName = rest.join(" ");
      changed = true;
    }

    const phone = String(address?.phone || "").replace(/\D/g, "").slice(-10);
    if (!user.phone && /^[6-9]\d{9}$/.test(phone)) {
      const taken = await User.findOne({ phone, _id: { $ne: user._id } });
      if (!taken) {
        user.phone = phone;
        changed = true;
      }
    }

    // Remember it for next checkout (prefilled), latest one wins.
    if (!user.email && contactEmail && user.contactEmail !== contactEmail) {
      user.contactEmail = contactEmail;
      changed = true;
    }

    if (changed) await user.save();
    return changed;
  } catch (error) {
    console.error("Couldn't copy name/phone from the address:", error.message);
    return false;
  }
}

module.exports = { fillProfileFromAddress };
