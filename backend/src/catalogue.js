import { C, read, readAll } from './firestore.js';

export async function getSetting(db, key, tx) {
  const snap = await read(db.collection(C.settings).doc(key), tx);
  return snap.exists ? snap.data().value ?? null : null;
}

export const stockOf = data => {
  const onHand = data?.onHand ?? 0;
  const reserved = data?.reserved ?? 0;
  return { onHand, reserved, available: onHand - reserved };
};

/** Map of SKU → { onHand, reserved, available } from the per-SKU counter docs. */
export async function stockLevels(db, skus, tx) {
  const snaps = await readAll(db, [...new Set(skus)].map(sku => db.collection(C.skus).doc(sku)), tx);
  return new Map(snaps.map(snap => [snap.id, stockOf(snap.data())]));
}

const byCreated = (a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1);

export const categoryDto = (id, d) => ({ id, slug: d.slug, label: d.label, sortOrder: d.sortOrder, published: d.published, version: d.version });

export const variantDto = (id, d, stock) => ({
  id,
  productId: d.productId,
  sku: d.sku,
  attributes: d.attributes,
  retailPriceMinor: d.retailPriceMinor,
  currency: d.currency,
  active: d.active,
  stock: stock ?? stockOf(),
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/** Product fields only (no variants); used for audit snapshots and as the base of the admin DTO. */
export const productFields = (id, d) => ({
  id,
  slug: d.slug,
  title: d.title,
  description: d.description,
  tagline: d.tagline,
  categoryId: d.categoryId,
  brand: d.brand,
  specifications: d.specifications,
  images: d.images,
  illustration: d.illustration,
  publishStatus: d.publishStatus,
  hirePurchaseEnabled: d.hirePurchaseEnabled,
  illustrative: d.illustrative,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/** Admin DTOs for products, with variants and stock, in as few reads as possible. */
export async function adminProductDtos(db, productDocs) {
  if (!productDocs.length) return [];
  const ids = productDocs.map(doc => doc.id);
  const variantDocs = [];
  // Firestore "in" filters accept at most 30 values.
  for (let i = 0; i < ids.length; i += 30) {
    variantDocs.push(...(await db.collection(C.variants).where('productId', 'in', ids.slice(i, i + 30)).get()).docs);
  }
  const stock = await stockLevels(db, variantDocs.map(doc => doc.data().sku));
  const variantsByProduct = new Map();
  for (const doc of variantDocs) {
    const list = variantsByProduct.get(doc.data().productId) ?? [];
    list.push(variantDto(doc.id, doc.data(), stock.get(doc.data().sku)));
    variantsByProduct.set(doc.data().productId, list);
  }
  return productDocs.map(doc => ({ ...productFields(doc.id, doc.data()), variants: (variantsByProduct.get(doc.id) ?? []).sort(byCreated) }));
}

export async function adminProductDto(db, id) {
  const doc = await db.collection(C.products).doc(id).get();
  return (await adminProductDtos(db, [doc]))[0];
}

/**
 * Everything the public catalogue needs in four reads. Sized for a catalogue of up to a few hundred
 * products; beyond that, move to denormalised summary docs.
 */
export async function loadPublicCatalogue(db) {
  const [products, categories, variants, storeCurrency] = await Promise.all([
    db.collection(C.products).where('publishStatus', '==', 'published').get(),
    db.collection(C.categories).where('published', '==', true).get(),
    db.collection(C.variants).where('active', '==', true).get(),
    getSetting(db, 'store.currency'),
  ]);
  const categoriesById = new Map(categories.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
  const stock = await stockLevels(db, variants.docs.map(doc => doc.data().sku));
  const variantsByProduct = new Map();
  for (const doc of variants.docs) {
    const list = variantsByProduct.get(doc.data().productId) ?? [];
    list.push({ id: doc.id, ...doc.data() });
    variantsByProduct.set(doc.data().productId, list);
  }
  return {
    categories: [...categoriesById.values()],
    products: products.docs
      .filter(doc => categoriesById.has(doc.data().categoryId))
      .map(doc => ({ id: doc.id, ...doc.data(), category: categoriesById.get(doc.data().categoryId) })),
    variantsByProduct,
    stock,
    storeCurrency,
  };
}

// Checkout and hire-purchase applications are not built yet, so nothing is purchasable.
const RETAIL_UNAVAILABLE = { available: false, reason: 'checkout_not_configured' };

/** Public summary/detail. Only confirmed prices in the configured store currency are exposed. */
export function publicProductDto(product, { variantsByProduct, stock, storeCurrency }, { detail = false } = {}) {
  const variants = (variantsByProduct.get(product.id) ?? []).sort(byCreated);
  const priced = variants.filter(v => v.retailPriceMinor !== null && storeCurrency && v.currency === storeCurrency);
  const fromPrice = priced.length ? Math.min(...priced.map(v => v.retailPriceMinor)) : null;
  const available = priced.reduce((sum, v) => sum + Math.max(0, stock.get(v.sku)?.available ?? 0), 0);
  const summary = {
    id: product.id,
    slug: product.slug,
    title: product.title,
    tagline: product.tagline,
    category: { id: product.category.id, slug: product.category.slug, label: product.category.label },
    brand: product.brand,
    images: product.images,
    illustration: product.illustration,
    illustrative: product.illustrative,
    price: fromPrice === null ? null : { fromAmountMinor: fromPrice, currency: storeCurrency, varies: new Set(priced.map(v => v.retailPriceMinor)).size > 1 },
    availability: priced.length === 0 ? 'unconfirmed' : available > 0 ? 'in_stock' : 'out_of_stock',
    hirePurchaseEnabled: product.hirePurchaseEnabled,
  };
  if (!detail) return summary;
  return {
    ...summary,
    description: product.description,
    specifications: product.specifications,
    variants: priced.map(v => ({
      sku: v.sku,
      attributes: v.attributes,
      price: { amountMinor: v.retailPriceMinor, currency: v.currency },
      availability: (stock.get(v.sku)?.available ?? 0) > 0 ? 'in_stock' : 'out_of_stock',
    })),
    purchaseModes: {
      retail: RETAIL_UNAVAILABLE,
      hirePurchase: { eligible: product.hirePurchaseEnabled, available: false, reason: 'applications_not_configured' },
    },
    // Owner-approved delivery, returns and warranty policies are not supplied yet.
    policies: [],
  };
}

/** Fields a product needs before it can be published, as field errors. */
export async function publishReadiness(db, product, tx) {
  const errors = {};
  if (!product.description.trim()) errors.description = 'Add a description before publishing.';
  if (product.images.length === 0 && !product.illustration) errors.images = 'Add at least one image or illustration before publishing.';
  const category = await read(db.collection(C.categories).doc(product.categoryId), tx);
  if (!category.exists || !category.data().published) errors.categoryId = 'The category must be published first.';
  return errors;
}
