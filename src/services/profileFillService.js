const User = require("../models/User");

/**
 * Customers may skip giving their name when they sign up. If they did, the
 * name on their first delivery address becomes the account name. Phone and
 * email on an address stay with the address: they never change the account
 * or how it signs in. Never throws.
 */
async function fillProfileFromAddress(userId, address) {
  try {
    const fullName = String(address?.fullName || "").trim();
    if (!fullName) return false;
    const user = await User.findById(userId);
    if (!user || user.firstName) return false;

    const [first, ...rest] = fullName.split(/\s+/);
    user.firstName = first;
    if (!user.lastName) user.lastName = rest.join(" ");
    await user.save();
    return true;
  } catch (error) {
    console.error("Couldn't copy the name from the address:", error.message);
    return false;
  }
}

module.exports = { fillProfileFromAddress };
