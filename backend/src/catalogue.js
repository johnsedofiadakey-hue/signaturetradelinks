import { json, now } from './db.js';

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

/** On-hand, reserved and available quantities for the given SKUs (all SKUs when omitted). */
export function stockLevels(db, skus) {
  const at = now();
  const filter = skus ? `WHERE v.sku IN (${skus.map(() => '?').join(',') || "''"})` : '';
  const rows = db.prepare(`
    SELECT v.sku,
      COALESCE((SELECT SUM(m.quantity) FROM inventory_movements m WHERE m.sku = v.sku), 0) AS on_hand,
      COALESCE((SELECT SUM(r.quantity) FROM reservations r WHERE r.sku = v.sku AND r.status = 'active' AND r.expires_at > ?), 0) AS reserved
    FROM variants v ${filter}`).all(at, ...(skus ?? []));
  return new Map(rows.map(row => [row.sku, { onHand: row.on_hand, reserved: row.reserved, available: row.on_hand - row.reserved }]));
}

export const categoryDto = row => ({
  id: row.id, slug: row.slug, label: row.label, sortOrder: row.sort_order, published: Boolean(row.published), version: row.version,
});

export const variantDto = (row, stock) => ({
  id: row.id,
  productId: row.product_id,
  sku: row.sku,
  attributes: json(row.attributes),
  retailPriceMinor: row.retail_price_minor,
  currency: row.currency,
  active: Boolean(row.active),
  stock: stock ?? { onHand: 0, reserved: 0, available: 0 },
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function adminProductDto(db, row) {
  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY created_at, id').all(row.id);
  const stock = stockLevels(db, variants.map(v => v.sku));
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    tagline: row.tagline,
    categoryId: row.category_id,
    brand: row.brand,
    specifications: json(row.specifications),
    images: json(row.images),
    illustration: row.illustration,
    publishStatus: row.publish_status,
    hirePurchaseEnabled: Boolean(row.hire_purchase_enabled),
    illustrative: Boolean(row.illustrative),
    variants: variants.map(v => variantDto(v, stock.get(v.sku))),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Checkout and hire-purchase applications are not built yet, so nothing is purchasable.
const RETAIL_UNAVAILABLE = { available: false, reason: 'checkout_not_configured' };

/** Public summary/detail. Only confirmed prices in the configured store currency are exposed. */
export function publicProductDto(db, row, { detail = false } = {}) {
  const storeCurrency = getSetting(db, 'store.currency');
  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ? AND active = 1 ORDER BY created_at, id').all(row.id);
  const stock = stockLevels(db, variants.map(v => v.sku));
  const priced = variants.filter(v => v.retail_price_minor !== null && storeCurrency && v.currency === storeCurrency);
  const fromPrice = priced.length ? Math.min(...priced.map(v => v.retail_price_minor)) : null;
  const available = priced.reduce((sum, v) => sum + Math.max(0, stock.get(v.sku)?.available ?? 0), 0);
  const summary = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    category: { id: row.category_id, slug: row.category_slug, label: row.category_label },
    brand: row.brand,
    images: json(row.images),
    illustration: row.illustration,
    illustrative: Boolean(row.illustrative),
    price: fromPrice === null ? null : { fromAmountMinor: fromPrice, currency: storeCurrency, varies: new Set(priced.map(v => v.retail_price_minor)).size > 1 },
    availability: priced.length === 0 ? 'unconfirmed' : available > 0 ? 'in_stock' : 'out_of_stock',
    hirePurchaseEnabled: Boolean(row.hire_purchase_enabled),
  };
  if (!detail) return summary;
  return {
    ...summary,
    description: row.description,
    specifications: json(row.specifications),
    variants: priced.map(v => ({
      sku: v.sku,
      attributes: json(v.attributes),
      price: { amountMinor: v.retail_price_minor, currency: v.currency },
      availability: (stock.get(v.sku)?.available ?? 0) > 0 ? 'in_stock' : 'out_of_stock',
    })),
    purchaseModes: {
      retail: RETAIL_UNAVAILABLE,
      hirePurchase: { eligible: Boolean(row.hire_purchase_enabled), available: false, reason: 'applications_not_configured' },
    },
    // Owner-approved delivery, returns and warranty policies are not supplied yet.
    policies: [],
  };
}

/** Fields a product needs before it can be published, as field errors. */
export function publishReadiness(db, row) {
  const errors = {};
  if (!row.description.trim()) errors.description = 'Add a description before publishing.';
  if (json(row.images).length === 0 && !row.illustration) errors.images = 'Add at least one image or illustration before publishing.';
  const category = db.prepare('SELECT published FROM categories WHERE id = ?').get(row.category_id);
  if (!category?.published) errors.categoryId = 'The category must be published first.';
  return errors;
}
