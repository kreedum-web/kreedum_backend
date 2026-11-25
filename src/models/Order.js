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

    // Where this order's emails go (confirmation, cancellation): the
    // account's email, or the one typed at checkout by phone-only accounts.
    contactEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },

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
      // REFUND_INITIATED: refund sent to Cashfree, waiting for the bank.
      enum: ["PENDING", "PAID", "FAILED", "REFUND_INITIATED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },

    orderStatus: {
      type: String,
      enum: [
        // Online payment chosen, not paid yet (cancelled by itself after an hour).
        "AWAITING_PAYMENT",
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

    // How it was shipped (set when marked Shipped in the admin).
    shipment: {
      courier: { type: String, default: "" }, // "Delhivery"
      trackingId: { type: String, default: "" },
      trackingUrl: { type: String, default: "" }, // link to track it
      shippedAt: { type: Date, default: null },
    },

    // Emails the team wrote to the customer from the admin.
    customerEmails: [
      {
        subject: String,
        message: String,
        by: String,
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],

    statusHistory: {
      type: [orderStatusHistorySchema],
      default: [{ status: "PENDING" }],
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    // When someone in the admin dashboard first opened this order. Empty =
    // a new order the dashboard still shows as "new".
    adminSeenAt: {
      type: Date,
      default: null,
      index: true,
    },

    // Online payment through Cashfree (paymentMethod ONLINE).
    payment: {
      gateway: { type: String, default: "" },          // "cashfree"
      gatewayOrderId: { type: String, default: "", index: true }, // Cashfree's order_id (ours)
      sessionId: { type: String, default: "" },        // payment_session_id for the checkout
      sessionExpiresAt: { type: Date },
      paymentId: { type: String, default: "" },        // cf_payment_id of the successful payment
      method: { type: String, default: "" },           // upi, credit_card, net_banking …
      paidAt: { type: Date },
      lastFailure: { type: String, default: "" },
      expired: { type: Boolean, default: false },      // not paid in time → cancelled
      refundId: { type: String, default: "" },
      refundStatus: { type: String, default: "" },     // PENDING, SUCCESS, FAILED, NOT_STARTED
      refundedAt: { type: Date },
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