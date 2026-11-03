const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    label: {
      type: String,
      enum: ["Home", "Office", "Hostel", "Other"],
      default: "Home",
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    // Where emails about orders to this address go. Only for delivery
    // updates: never used to sign in. Older addresses don't have one.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },

    addressLine1: {
      type: String,
      required: true,
      trim: true,
    },

    addressLine2: {
      type: String,
      trim: true,
      default: "",
    },

    locality: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      trim: true,
    },

    district: {
      type: String,
      required: true,
      trim: true,
    },

    state: {
      type: String,
      required: true,
      trim: true,
    },

    country: {
      type: String,
      default: "India",
      trim: true,
    },

    pincode: {
      type: String,
      required: true,
      match: /^[1-9][0-9]{5}$/,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "addresses",
  }
);

// One customer cannot save duplicate addresses.
addressSchema.index(
  {
    user: 1,
    addressLine1: 1,
    pincode: 1,
  },
  {
    unique: true,
    name: "address_user_unique",
  }
);

module.exports = mongoose.model("Address", addressSchema);