const mongoose = require("mongoose");

const Address = require("../models/Address");

const HttpError = require("../utils/httpError");

// Only these come from the customer; the owner, default flag and status are
// set here (a request can't move an address to another account).
const FIELDS = ["label", "fullName", "phone", "email", "addressLine1", "addressLine2", "locality", "city", "district", "state", "country", "pincode"];
const REQUIRED = ["fullName", "phone", "addressLine1", "locality", "city", "district", "state", "pincode"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanAddress(raw = {}, { requireAll }) {
  const address = {};
  for (const field of FIELDS) {
    if (raw[field] !== undefined && raw[field] !== null) address[field] = String(raw[field]).trim();
  }
  if (requireAll && REQUIRED.some((field) => !address[field])) {
    throw new HttpError(400, "Complete all required address fields.", "ADDRESS_INCOMPLETE");
  }
  if (address.phone !== undefined && !/^[6-9]\d{9}$/.test(address.phone)) {
    throw new HttpError(400, "Enter a valid 10-digit mobile number.", "INVALID_PHONE");
  }
  if (address.pincode !== undefined && !/^[1-9]\d{5}$/.test(address.pincode)) {
    throw new HttpError(400, "Enter a valid 6-digit PIN code.", "INVALID_PINCODE");
  }
  if (address.email !== undefined) {
    address.email = address.email.toLowerCase();
    if (address.email && !EMAIL_PATTERN.test(address.email)) {
      throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
    }
  }
  return address;
}

class savedAddressService {

  // =====================================================
  // Create New Address
  // =====================================================

  async createAddress(userId, rawPayload) {

    const payload = cleanAddress(rawPayload, { requireAll: true });

    const existing = await Address.findOne({
      user: userId,
      addressLine1: payload.addressLine1.trim(),
      pincode: payload.pincode,
      isActive: true,
    });

    if (existing) {
      throw new Error("Address already exists.");
    }

    const totalAddresses = await Address.countDocuments({
      user: userId,
      isActive: true,
    });

    const address = await Address.create({
      user: userId,
      ...payload,
      isDefault: totalAddresses === 0,
    });

    return address;
  }

  // =====================================================
  // Get All Addresses
  // =====================================================

  async getAddresses(userId) {

    return await Address.find({
      user: userId,
      isActive: true,
    })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
  }

  // =====================================================
  // Get Single Address
  // =====================================================

  async getAddressById(userId, addressId) {

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new Error("Invalid address ID.");
    }

    const address = await Address.findOne({
      _id: addressId,
      user: userId,
      isActive: true,
    }).lean();

    if (!address) {
      throw new Error("Address not found.");
    }

    return address;
  }

  // =====================================================
  // Update Address
  // =====================================================

  async updateAddress(userId, addressId, rawPayload) {

    const payload = cleanAddress(rawPayload, { requireAll: false });

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new Error("Invalid address ID.");
    }

    const address = await Address.findOne({
      _id: addressId,
      user: userId,
      isActive: true,
    });

    if (!address) {
      throw new Error("Address not found.");
    }

    Object.assign(address, payload);

    await address.save();

    return address;
  }

  // =====================================================
  // Set Default Address
  // =====================================================

  async setDefaultAddress(userId, addressId) {

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new Error("Invalid address ID.");
    }

    const address = await Address.findOne({
      _id: addressId,
      user: userId,
      isActive: true,
    });

    if (!address) {
      throw new Error("Address not found.");
    }

    await Address.updateMany(
      { user: userId },
      { isDefault: false }
    );

    address.isDefault = true;
    await address.save();

    return address;
  }

  // =====================================================
  // Delete Address (Soft Delete)
  // =====================================================

  async deleteAddress(userId, addressId) {

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      throw new Error("Invalid address ID.");
    }

    const address = await Address.findOne({
      _id: addressId,
      user: userId,
      isActive: true,
    });

    if (!address) {
      throw new Error("Address not found.");
    }

    const wasDefault = address.isDefault;

    address.isActive = false;
    address.isDefault = false;

    await address.save();

    // Promote another address if default was deleted
    if (wasDefault) {
      const nextAddress = await Address.findOne({
        user: userId,
        isActive: true,
      }).sort({ createdAt: 1 });

      if (nextAddress) {
        nextAddress.isDefault = true;
        await nextAddress.save();
      }
    }

    return {
      success: true,
      message: "Address deleted successfully.",
    };
  }
}

module.exports = new savedAddressService();