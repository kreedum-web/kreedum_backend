require("../config/bootstrap");

const connectDatabase = require("../config/database");

const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const User = require("../models/User");
const Wishlist = require("../models/Wishlist");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Address = require("../models/Address");
const ensureCartIndexes = require("../utils/ensureCartIndexes");

/**
 * Safely create an index.
 * If the index already exists (even with a different name),
 * it skips instead of throwing an error.
 */
async function safeCreateIndex(collection, keys, options = {}) {
  try {
    await collection.createIndex(keys, options);
    console.log(`✅ Created: ${options.name || JSON.stringify(keys)}`);
  } catch (err) {
    if (err.code === 85 || err.code === 86) {
      console.log(`⏭️ Already exists: ${options.name || JSON.stringify(keys)}`);
    } else {
      throw err;
    }
  }
}

async function createIndexes() {
  await connectDatabase();

  console.log("🚀 Creating MongoDB Indexes...\n");

  // ===========================
  // PRODUCTS
  // ===========================

  await safeCreateIndex(
    Product.collection,
    { slug: 1 },
    { unique: true, name: "product_slug_unique" }
  );

  await safeCreateIndex(
    Product.collection,
    { sku: 1 },
    { sparse: true, name: "product_sku" }
  );

  await safeCreateIndex(
    Product.collection,
    { brand: 1 },
    { name: "product_brand" }
  );

  await safeCreateIndex(
    Product.collection,
    { department: 1, parentCategory: 1, childCategory: 1 },
    { name: "product_category_tree" }
  );

  await safeCreateIndex(
    Product.collection,
    { sellingPrice: 1 },
    { name: "product_price" }
  );

  await safeCreateIndex(
    Product.collection,
    { isFeatured: 1, isBestSeller: 1, isNewArrival: 1 },
    { name: "product_flags" }
  );

  await safeCreateIndex(
    Product.collection,
    { stockStatus: 1, visibility: 1 },
    { name: "product_stock_visibility" }
  );

  // Full Text Search Index
  await safeCreateIndex(
    Product.collection,
    {
      name: "text",
      brand: "text",
      sku: "text",
      searchKeywords: "text",
      descriptionText: "text",
    },
    {
      name: "product_text_search",
      weights: {
        name: 10,
        sku: 9,
        brand: 8,
        searchKeywords: 7,
        descriptionText: 2,
      },
    }
  );

  console.log("✅ Product indexes completed.\n");

  // ===========================
  // CATEGORIES
  // ===========================

  await safeCreateIndex(
    Category.collection,
    { slug: 1 },
    { unique: true, name: "category_slug_unique" }
  );

  await safeCreateIndex(
    Category.collection,
    { level: 1, parentSlug: 1 },
    { name: "category_hierarchy" }
  );

  await safeCreateIndex(
    Category.collection,
    { rootSlug: 1 },
    { name: "category_root" }
  );

  console.log("✅ Category indexes completed.\n");

  // ===========================
  // BRANDS
  // ===========================

  await safeCreateIndex(
    Brand.collection,
    { slug: 1 },
    { unique: true, name: "brand_slug_unique" }
  );

  await safeCreateIndex(
    Brand.collection,
    { name: 1 },
    { name: "brand_name" }
  );

  await safeCreateIndex(
  User.collection,
  { email: 1 },
  {
    unique: true,
    name: "user_email_unique",
  }
);

// ===========================
// WISHLIST
// ===========================

await safeCreateIndex(
  Wishlist.collection,
  { user: 1, product: 1 },
  {
    unique: true,
    name: "wishlist_user_product_unique",
  }
);

await safeCreateIndex(
  Wishlist.collection,
  { user: 1 },
  {
    name: "wishlist_user",
  }
);

// ===========================
// CART
// ===========================

// One line per product + option; replaces the old per-product index.
await ensureCartIndexes();

await safeCreateIndex(
  Cart.collection,
  { user: 1 },
  {
    name: "cart_user",
  }
);

console.log("✅ Cart indexes created.");

// ===========================
// ORDERS
// ===========================

await safeCreateIndex(
  Order.collection,
  { orderNumber: 1 },
  {
    unique: true,
    name: "order_number_unique",
  }
);

await safeCreateIndex(
  Order.collection,
  { user: 1, createdAt: -1 },
  {
    name: "order_user_createdAt",
  }
);

await safeCreateIndex(
  Order.collection,
  { orderStatus: 1 },
  {
    name: "order_status",
  }
);

await safeCreateIndex(
  Order.collection,
  { paymentStatus: 1 },
  {
    name: "payment_status",
  }
);



// ===========================
// ADDRESSES
// ===========================

await safeCreateIndex(
  Address.collection,
  { user: 1 },
  {
    name: "address_user",
  }
);

await safeCreateIndex(
  Address.collection,
  { user: 1, isDefault: 1 },
  {
    name: "address_default",
  }
);

await safeCreateIndex(
  Address.collection,
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

console.log("✅ Address indexes created.");

console.log("✅ Order indexes created.");


console.log("✅ Wishlist indexes created.");

console.log("✅ User indexes created.");

  console.log("✅ Brand indexes completed.\n");

  console.log("🎉 ALL INDEXES CREATED / VERIFIED SUCCESSFULLY.");

  process.exit(0);
}

createIndexes().catch((err) => {
  console.error("❌ Index Migration Failed");
  console.error(err);
  process.exit(1);
});