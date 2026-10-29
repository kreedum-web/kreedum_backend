/**
 * Products sold in several weights / sizes ("variants"), e.g. a dumbbell at
 * 2.5 kg for ₹1,249 and 10 kg for ₹4,999. Everything that prices a product
 * for a customer (cart, order) goes through here, so the price always comes
 * from the chosen variant and never from the product's "from" price.
 */

function hasVariants(product) {
  return Array.isArray(product?.variants) && product.variants.length > 0;
}

function findVariant(product, variantId) {
  if (!hasVariants(product) || !variantId) return null;
  return product.variants.find((variant) => variant.variantId === String(variantId)) || null;
}

/** "Weight: 5 kg" / "Size: M, Colour: Red" — what the customer chose. */
function describeVariant(product, variant) {
  if (!variant) return "";
  const options = variant.options || {};
  const names = (product.options || []).map((option) => option.name);
  const keys = names.length ? names.filter((name) => options[name]) : Object.keys(options);
  return keys.length ? keys.map((name) => `${name}: ${options[name]}`).join(", ") : variant.label || "";
}

/**
 * What one unit costs and how it is shown: the variant's own price, SKU and
 * photo when one is chosen, otherwise the product's.
 */
function pricing(product, variant) {
  const sellingPrice = Number(variant ? variant.sellingPrice : product.sellingPrice ?? product.salePrice ?? product.price) || 0;
  const mrp = Number(variant ? variant.mrp : product.mrp) || sellingPrice;
  return {
    sellingPrice,
    mrp: Math.max(mrp, sellingPrice),
    discountPercent: mrp > sellingPrice && sellingPrice > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0,
    sku: (variant && variant.sku) || product.sku || "",
    thumbnail: (variant && variant.image) || product.thumbnail || product.images?.[0] || "",
    variantLabel: describeVariant(product, variant),
  };
}

/**
 * Check a customer's choice before it goes in the cart or an order.
 * Returns the variant (or null for products without options); throws with a
 * message the website can show.
 */
function resolveVariant(product, variantId) {
  if (!hasVariants(product)) {
    if (variantId) throw new Error("This product has no options to choose from.");
    return null;
  }

  if (!variantId) {
    const names = (product.options || []).map((o) => o.name.toLowerCase()).join(" and ") || "an option";
    throw new Error(`Please choose ${names} first.`);
  }

  const variant = findVariant(product, variantId);
  if (!variant) throw new Error("This option is no longer available. Please choose another.");
  if (variant.inStock === false) throw new Error("This option is out of stock. Please choose another.");
  return variant;
}

/**
 * Options of a product sold in several weights / sizes, from the scraper's
 * `options` / `variants`. Variants without a price or id are dropped; an
 * option value nobody sells any more disappears with them.
 */
function variantsFromSupplier(sp, sellingPrice) {
  const variants = (Array.isArray(sp.variants) ? sp.variants : [])
    .filter((v) => v && v.variantId && Number(v.sellingPrice) > 0)
    .map((v) => {
      const price = Number(v.sellingPrice);
      return {
        variantId: String(v.variantId),
        options: v.options || {},
        label: v.label || "",
        sku: v.sku || "",
        mrp: Math.max(Number(v.mrp) || 0, price),
        sellingPrice: price,
        inStock: v.inStock !== false,
        image: v.image || "",
      };
    });

  if (!variants.length) return { options: [], variants: [], maxPrice: sellingPrice };

  const options = (sp.options || [])
    .map((o) => ({
      name: o.name,
      values: (o.values || []).filter((value) => variants.some((v) => v.options[o.name] === value)),
    }))
    .filter((o) => o.name && o.values.length);

  return { options, variants, maxPrice: Math.max(...variants.map((v) => v.sellingPrice)) };
}

module.exports = { hasVariants, findVariant, describeVariant, pricing, resolveVariant, variantsFromSupplier };
