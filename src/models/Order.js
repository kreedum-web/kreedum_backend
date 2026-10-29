const mongoose = require("mongoose");

/* -------------------- Ordered Product Snapshot -------------------- */

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    slug: String,

    brand: String,

    thumbnail: String,

    sku: String,

    // Chosen option of a product sold in several weights / sizes,
    // e.g. variantLabel "Weight: 5 kg". Empty for products without options.
    variantId: {
      type: String,
      default: "",
    },

    variantLabel: {
      type: String,
      default: "",
    },

    price: {
      type: Number,
      required: true,
    },

    mrp: Number,

    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    total: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

/* -------------------- Shipping Address Snapshot -------------------- */

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
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
    },

    city: {
      type: String,
      required: true,
    },

    district: {
      type: String,
      required: true,
    },

    state: {
      type: String,
      required: true,
    },

    country: {
      type: String,
      default: "India",
    },

    pincode: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

/* -------------------- Status History -------------------- */

const orderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    note: String,
  },
  { _id: false }
);

/* -------------------- Main Order Schema -------------------- */

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    items: {
      type: [orderItemSchema],
      validate: [(arr) => arr.length > 0, "Order must contain products."],
    },

    shippingAddress: shippingAddressSchema,

    pricing: {
      subtotal: {
        type: Number,
        required: true,
      },

      shippingCharge: {
        type: Number,
        default: 0,
      },

      discount: {
        type: Number,
        default: 0,
      },

      gst: {
        type: Number,
        default: 0,
      },

      total: {
        type: Number,
        required: true,
      },
    },

    paymentMethod: {
      type: String,
      enum: ["COD", "ONLINE", "UPI"],
      default: "COD",
    },

    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },

    orderStatus: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "PACKED",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
        "RETURNED",
      ],
      default: "PENDING",
      index: true,
    },

    statusHistory: {
      type: [orderStatusHistorySchema],
      default: [{ status: "PENDING" }],
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/* -------------------- Order Number Generator -------------------- */

orderSchema.pre("save", async function (next) {
  if (this.orderNumber) return next();

  const today = new Date();

  const datePart =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const count = await mongoose.models.Order.countDocuments({
    createdAt: {
      $gte: new Date(today.setHours(0, 0, 0, 0)),
    },
  });

  this.orderNumber = `KRD-${datePart}-${String(count + 1).padStart(4, "0")}`;

  next();
});

module.exports = mongoose.model("Order", orderSchema);