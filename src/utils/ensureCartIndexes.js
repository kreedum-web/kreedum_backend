const Cart = require("../models/Cart");

const OLD_INDEX = "cart_user_product_unique";

/**
 * The cart used to allow one line per product. Products with options need one
 * line per product + option, so the old unique index must go (MongoDB never
 * drops an index by itself). Runs at server start; does nothing once done.
 */
async function ensureCartIndexes() {
  try {
    const indexes = await Cart.collection.indexes();
    if (indexes.some((index) => index.name === OLD_INDEX)) {
      await Cart.collection.dropIndex(OLD_INDEX);
      console.log(`🛒 Cart: dropped old index ${OLD_INDEX}`);
    }
  } catch (error) {
    // Collection not created yet: nothing to drop.
    if (error.codeName !== "NamespaceNotFound" && error.code !== 26) throw error;
  }

  await Cart.createIndexes();
}

module.exports = ensureCartIndexes;
