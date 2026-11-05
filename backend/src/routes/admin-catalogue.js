import { PRODUCT_ILLUSTRATIONS, PRODUCT_STATUSES, PRODUCT_TRANSITIONS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { adminProductDto, categoryDto, getSetting, publishReadiness, stockLevels, variantDto } from '../catalogue.js';
import { newId, now, transaction } from '../db.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import {
  IMAGE_SRC, SKU, SLUG, arrayOf, bool, currency, int, nullable, oneOf, shape, str, stringMap, validate,
} from '../validate.js';
import { likePattern } from './public.js';

const slug = str({ max: 80, pattern: SLUG, patternMessage: 'Use lowercase letters, numbers and single hyphens.' });
const expectedVersion = int({ min: 1 });

const categorySpec = {
  slug,
  label: str({ max: 60 }),
  sortOrder: int({ min: 0, max: 10_000 }),
  published: bool(),
};

const productSpec = {
  slug,
  title: str({ max: 120 }),
  description: str({ min: 0, max: 4000 }),
  tagline: nullable(str({ max: 60 })),
  categoryId: str({ max: 64 }),
  brand: nullable(str({ max: 80 })),
  specifications: arrayOf(shape({ label: str({ max: 60 }), value: str({ max: 200 }) }), { max: 40 }),
  images: arrayOf(shape({ src: str({ max: 500, pattern: IMAGE_SRC, patternMessage: 'Use a site path like /phone.jpg or an https:// URL.' }), alt: str({ max: 200 }) }), { max: 12 }),
  illustration: nullable(oneOf(PRODUCT_ILLUSTRATIONS)),
};

const variantSpec = {
  sku: str({ max: 40, pattern: SKU, patternMessage: 'Use 2–40 uppercase letters, numbers and hyphens.' }),
  attributes: stringMap(),
  retailPriceMinor: nullable(int({ min: 0, max: 1_000_000_000 })),
  currency: nullable(currency()),
  active: bool(),
};

const PRODUCT_COLUMNS = {
  slug: 'slug', title: 'title', description: 'description', tagline: 'tagline', categoryId: 'category_id', brand: 'brand',
  specifications: 'specifications', images: 'images', illustration: 'illustration',
};
const JSON_FIELDS = new Set(['specifications', 'images', 'attributes']);
const toColumn = (field, value) => (JSON_FIELDS.has(field) ? JSON.stringify(value) : typeof value === 'boolean' ? Number(value) : value);

function loadProduct(db, id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) fail('not_found', 'Product not found.');
  return row;
}

function ensureCategory(db, categoryId) {
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { categoryId: 'Choose an existing category.' } });
  }
}

function ensureUnique(db, table, column, value, field, exceptId = null) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(value);
  if (row && row.id !== exceptId) fail('conflict', 'That value is already in use.', { fieldErrors: { [field]: 'Already in use.' } });
}

/** A price needs the owner-configured store currency, and must be in it. */
function checkPrice(db, { retailPriceMinor, currency: code }) {
  if ((retailPriceMinor === null) !== (code === null)) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { currency: 'Set price and currency together.' } });
  }
  if (retailPriceMinor === null) return;
  const storeCurrency = getSetting(db, 'store.currency');
  if (!storeCurrency) fail('commercial_setting_missing', 'The owner must confirm the store currency before prices can be set.');
  if (code !== storeCurrency) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { currency: `Prices must use the store currency (${storeCurrency}).` } });
  }
}

/** UPDATE guarded by optimistic concurrency. Throws 409 when the row moved on. */
function updateVersioned(db, table, id, version, assignments) {
  const fields = Object.keys(assignments);
  const result = db.prepare(`UPDATE ${table} SET ${fields.map(f => `${f} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .run(...fields.map(f => assignments[f]), now(), id, version);
  if (result.changes === 0) fail('stale_version', 'This record was changed by someone else. Reload to see the latest version.');
}

export function registerAdminCatalogue(route) {
  route('GET', '/admin/categories', ctx => {
    requireStaff(ctx, 'catalogue:read');
    return { data: ctx.db.prepare('SELECT * FROM categories ORDER BY sort_order, label').all().map(categoryDto) };
  });

  route('POST', '/admin/categories', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, categorySpec);
    return transaction(ctx.db, () => {
      ensureUnique(ctx.db, 'categories', 'slug', input.slug, 'slug');
      const id = newId('cat');
      const at = now();
      ctx.db.prepare('INSERT INTO categories (id, slug, label, sort_order, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.slug, input.label, input.sortOrder, Number(input.published), at, at);
      const created = categoryDto(ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'category.created', resourceType: 'category', resourceId: id, after: created });
      return { status: 201, data: created };
    });
  });

  route('PATCH', '/admin/categories/:id', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...categorySpec, expectedVersion }, { partial: true });
    if (!version) fail('validation_failed', 'Some details need attention.', { fieldErrors: { expectedVersion: 'Required.' } });
    return transaction(ctx.db, () => {
      const before = ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(ctx.params.id);
      if (!before) fail('not_found', 'Category not found.');
      if (changes.slug) ensureUnique(ctx.db, 'categories', 'slug', changes.slug, 'slug', before.id);
      const columns = { slug: 'slug', label: 'label', sortOrder: 'sort_order', published: 'published' };
      const assignments = Object.fromEntries(Object.entries(changes).map(([k, v]) => [columns[k], toColumn(k, v)]));
      updateVersioned(ctx.db, 'categories', before.id, version, assignments);
      const after = categoryDto(ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(before.id));
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'category.updated', resourceType: 'category', resourceId: before.id, before: categoryDto(before), after });
      return { data: after };
    });
  });

  route('GET', '/admin/products', ctx => {
    requireStaff(ctx, 'catalogue:read');
    const { query, db } = ctx;
    const limit = parseLimit(query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(query.get('cursor') ?? undefined, 2);
    const where = [];
    const params = [];
    const status = query.get('status');
    if (status) {
      if (!PRODUCT_STATUSES.includes(status)) fail('validation_failed', 'The status filter is invalid.', { fieldErrors: { status: 'Unknown status.' } });
      where.push('publish_status = ?');
      params.push(status);
    }
    const q = query.get('q')?.trim();
    if (q) { where.push("(lower(title) LIKE ? ESCAPE '\\' OR lower(slug) LIKE ? ESCAPE '\\')"); params.push(likePattern(q), likePattern(q)); }
    if (cursor) { where.push('(lower(title) > ? OR (lower(title) = ? AND id > ?))'); params.push(cursor[0], cursor[0], cursor[1]); }
    const rows = db.prepare(`SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(title), id LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: {
        items: page.map(row => adminProductDto(db, row)),
        nextCursor: rows.length > limit ? encodeCursor([last.title.toLowerCase(), last.id]) : null,
      },
    };
  });

  route('GET', '/admin/products/:id', ctx => {
    requireStaff(ctx, 'catalogue:read');
    return { data: adminProductDto(ctx.db, loadProduct(ctx.db, ctx.params.id)) };
  });

  route('POST', '/admin/products', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, productSpec, { optional: ['tagline', 'brand', 'specifications', 'images', 'illustration', 'description'] });
    return transaction(ctx.db, () => {
      ensureCategory(ctx.db, input.categoryId);
      ensureUnique(ctx.db, 'products', 'slug', input.slug, 'slug');
      const id = newId('prd');
      const at = now();
      ctx.db.prepare(`
        INSERT INTO products (id, slug, title, description, tagline, category_id, brand, specifications, images, illustration, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.slug, input.title, input.description ?? '', input.tagline ?? null, input.categoryId, input.brand ?? null,
        JSON.stringify(input.specifications ?? []), JSON.stringify(input.images ?? []), input.illustration ?? null, at, at,
      );
      const created = adminProductDto(ctx.db, loadProduct(ctx.db, id));
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'product.created', resourceType: 'product', resourceId: id, after: created });
      return { status: 201, data: created };
    });
  });

  route('PATCH', '/admin/products/:id', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...productSpec, expectedVersion }, { partial: true });
    if (!version) fail('validation_failed', 'Some details need attention.', { fieldErrors: { expectedVersion: 'Required.' } });
    return transaction(ctx.db, () => {
      const before = loadProduct(ctx.db, ctx.params.id);
      if (changes.slug && changes.slug !== before.slug) {
        // Changing a live URL would break links customers already have.
        if (before.publish_status === 'published') fail('slug_locked', 'Unpublish the product before changing its web address.');
        ensureUnique(ctx.db, 'products', 'slug', changes.slug, 'slug', before.id);
      }
      if (changes.categoryId) ensureCategory(ctx.db, changes.categoryId);
      const assignments = Object.fromEntries(Object.entries(changes).map(([k, v]) => [PRODUCT_COLUMNS[k], toColumn(k, v)]));
      if (!Object.keys(assignments).length) fail('validation_failed', 'Nothing to update.');
      const beforeDto = adminProductDto(ctx.db, before);
      updateVersioned(ctx.db, 'products', before.id, version, assignments);
      const row = loadProduct(ctx.db, before.id);
      if (row.publish_status === 'published') {
        const errors = publishReadiness(ctx.db, row);
        if (Object.keys(errors).length) fail('not_ready', 'A published product must stay complete.', { fieldErrors: errors });
      }
      const after = adminProductDto(ctx.db, row);
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'product.updated', resourceType: 'product', resourceId: before.id, before: beforeDto, after });
      return { data: after };
    });
  });

  route('POST', '/admin/products/:id/transitions', ctx => {
    const staff = requireStaff(ctx, 'catalogue:publish');
    const input = validate(ctx.body, { action: oneOf(Object.keys(PRODUCT_TRANSITIONS)), expectedVersion, reason: str({ max: 500 }) }, { optional: ['reason'] });
    return transaction(ctx.db, () => {
      const before = loadProduct(ctx.db, ctx.params.id);
      const transition = PRODUCT_TRANSITIONS[input.action];
      if (!transition.from.includes(before.publish_status)) {
        fail('invalid_transition', `A ${before.publish_status} product cannot be ${input.action === 'restore' ? 'restored' : `${input.action}ed`}.`);
      }
      if (transition.to === 'published') {
        const errors = publishReadiness(ctx.db, before);
        if (Object.keys(errors).length) fail('not_ready', 'This product is not ready to publish.', { fieldErrors: errors });
      }
      updateVersioned(ctx.db, 'products', before.id, input.expectedVersion, { publish_status: transition.to });
      const after = adminProductDto(ctx.db, loadProduct(ctx.db, before.id));
      recordAudit(ctx.db, {
        ...auditFrom(ctx, staff), action: `product.${input.action}`, resourceType: 'product', resourceId: before.id,
        before: { publishStatus: before.publish_status }, after: { publishStatus: transition.to }, metadata: input.reason ? { reason: input.reason } : null,
      });
      return { data: after };
    });
  });

  // Hire-purchase eligibility is a policy decision, so it has its own permission and a mandatory reason.
  route('POST', '/admin/products/:id/hire-purchase', ctx => {
    const staff = requireStaff(ctx, 'catalogue:hire_purchase');
    const input = validate(ctx.body, { enabled: bool(), expectedVersion, reason: str({ min: 3, max: 500 }) });
    return transaction(ctx.db, () => {
      const before = loadProduct(ctx.db, ctx.params.id);
      updateVersioned(ctx.db, 'products', before.id, input.expectedVersion, { hire_purchase_enabled: Number(input.enabled) });
      recordAudit(ctx.db, {
        ...auditFrom(ctx, staff), action: 'product.hire_purchase_changed', resourceType: 'product', resourceId: before.id,
        before: { hirePurchaseEnabled: Boolean(before.hire_purchase_enabled) }, after: { hirePurchaseEnabled: input.enabled }, metadata: { reason: input.reason },
      });
      return { data: adminProductDto(ctx.db, loadProduct(ctx.db, before.id)) };
    });
  });

  route('POST', '/admin/products/:id/variants', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, variantSpec, { optional: ['attributes', 'retailPriceMinor', 'currency', 'active'] });
    const variant = { attributes: {}, retailPriceMinor: null, currency: null, active: true, ...input };
    return transaction(ctx.db, () => {
      const product = loadProduct(ctx.db, ctx.params.id);
      ensureUnique(ctx.db, 'variants', 'sku', variant.sku, 'sku');
      checkPrice(ctx.db, variant);
      const id = newId('var');
      const at = now();
      ctx.db.prepare(`
        INSERT INTO variants (id, product_id, sku, attributes, retail_price_minor, currency, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, product.id, variant.sku, JSON.stringify(variant.attributes), variant.retailPriceMinor, variant.currency, Number(variant.active), at, at,
      );
      const created = variantDto(ctx.db.prepare('SELECT * FROM variants WHERE id = ?').get(id));
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'variant.created', resourceType: 'variant', resourceId: id, after: created, metadata: { productId: product.id } });
      return { status: 201, data: created };
    });
  });

  route('PATCH', '/admin/variants/:id', ctx => {
    const staff = requireStaff(ctx, 'catalogue:write');
    const { sku: _immutable, ...editable } = variantSpec;
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...editable, expectedVersion }, { partial: true });
    if (!version) fail('validation_failed', 'Some details need attention.', { fieldErrors: { expectedVersion: 'Required.' } });
    return transaction(ctx.db, () => {
      const before = ctx.db.prepare('SELECT * FROM variants WHERE id = ?').get(ctx.params.id);
      if (!before) fail('not_found', 'Variant not found.');
      const price = {
        retailPriceMinor: 'retailPriceMinor' in changes ? changes.retailPriceMinor : before.retail_price_minor,
        currency: 'currency' in changes ? changes.currency : before.currency,
      };
      if ('retailPriceMinor' in changes || 'currency' in changes) checkPrice(ctx.db, price);
      const columns = { attributes: 'attributes', retailPriceMinor: 'retail_price_minor', currency: 'currency', active: 'active' };
      const assignments = Object.fromEntries(Object.entries(changes).map(([k, v]) => [columns[k], toColumn(k, v)]));
      if (!Object.keys(assignments).length) fail('validation_failed', 'Nothing to update.');
      updateVersioned(ctx.db, 'variants', before.id, version, assignments);
      const stock = stockLevels(ctx.db, [before.sku]).get(before.sku);
      const after = variantDto(ctx.db.prepare('SELECT * FROM variants WHERE id = ?').get(before.id), stock);
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'variant.updated', resourceType: 'variant', resourceId: before.id, before: variantDto(before, stock), after });
      return { data: after };
    });
  });
}
