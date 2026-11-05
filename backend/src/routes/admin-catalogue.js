import { PRODUCT_ILLUSTRATIONS, PRODUCT_STATUSES, PRODUCT_TRANSITIONS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import {
  adminProductDto, adminProductDtos, categoryDto, getSetting, productFields, publishReadiness, stockLevels, variantDto,
} from '../catalogue.js';
import { C, newId, now, transaction } from '../firestore.js';
import { decodeCursor, fail, parseLimit } from '../http.js';
import {
  IMAGE_SRC, SKU, SLUG, arrayOf, bool, currency, int, nullable, oneOf, shape, str, stringMap, validate,
} from '../validate.js';
import { matches, paginateByTitle } from './public.js';

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

// Where the product is sold: retail always; the hire-purchase store only when an approver says so, with a reason.
const hirePurchaseSpec = { enabled: bool(), reason: nullable(str({ min: 3, max: 500 })) };

const variantSpec = {
  sku: str({ max: 40, pattern: SKU, patternMessage: 'Use 2–40 uppercase letters, numbers and hyphens.' }),
  attributes: stringMap(),
  retailPriceMinor: nullable(int({ min: 0, max: 1_000_000_000 })),
  currency: nullable(currency()),
  active: bool(),
};

const requireVersion = version => {
  if (!version) fail('validation_failed', 'Some details need attention.', { fieldErrors: { expectedVersion: 'Required.' } });
};

const staleUnless = matched => {
  if (!matched) fail('stale_version', 'This record was changed by someone else. Reload to see the latest version.');
};

async function loadProduct(tx, db, id) {
  const snap = await tx.get(db.collection(C.products).doc(id));
  if (!snap.exists) fail('not_found', 'Product not found.');
  return snap;
}

async function ensureCategory(tx, db, categoryId) {
  if (!(await tx.get(db.collection(C.categories).doc(categoryId))).exists) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { categoryId: 'Choose an existing category.' } });
  }
}

/** Uniqueness is enforced with index docs keyed by the unique value. Read before any writes. */
async function ensureFree(tx, ref, field) {
  if ((await tx.get(ref)).exists) fail('conflict', 'That value is already in use.', { fieldErrors: { [field]: 'Already in use.' } });
}

/** A price needs the owner-configured store currency, and must be in it. */
async function checkPrice(db, tx, { retailPriceMinor, currency: code }) {
  if ((retailPriceMinor === null) !== (code === null)) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { currency: 'Set price and currency together.' } });
  }
  if (retailPriceMinor === null) return;
  const storeCurrency = await getSetting(db, 'store.currency', tx);
  if (!storeCurrency) fail('commercial_setting_missing', 'The owner must confirm the store currency before prices can be set.');
  if (code !== storeCurrency) {
    fail('validation_failed', 'Some details need attention.', { fieldErrors: { currency: `Prices must use the store currency (${storeCurrency}).` } });
  }
}

export function registerAdminCatalogue(route) {
  route('GET', '/admin/categories', async ctx => {
    await requireStaff(ctx, 'catalogue:read');
    const snap = await ctx.db.collection(C.categories).get();
    return { data: snap.docs.map(doc => categoryDto(doc.id, doc.data())).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)) };
  });

  route('POST', '/admin/categories', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, categorySpec);
    const id = newId('cat');
    const at = now();
    const created = { slug: input.slug, label: input.label, sortOrder: input.sortOrder, published: input.published, version: 1, createdAt: at, updatedAt: at };
    await transaction(ctx.db, async tx => {
      const slugRef = ctx.db.collection(C.categorySlugs).doc(input.slug);
      await ensureFree(tx, slugRef, 'slug');
      tx.create(slugRef, { categoryId: id });
      tx.create(ctx.db.collection(C.categories).doc(id), created);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'category.created', resourceType: 'category', resourceId: id, after: categoryDto(id, created) });
    });
    return { status: 201, data: categoryDto(id, created) };
  });

  route('PATCH', '/admin/categories/:id', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...categorySpec, expectedVersion }, { partial: true });
    requireVersion(version);
    const after = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.categories).doc(ctx.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not_found', 'Category not found.');
      const before = snap.data();
      const slugChanged = changes.slug && changes.slug !== before.slug;
      if (slugChanged) await ensureFree(tx, ctx.db.collection(C.categorySlugs).doc(changes.slug), 'slug');
      staleUnless(before.version === version);
      const next = { ...before, ...changes, version: before.version + 1, updatedAt: now() };
      if (slugChanged) {
        tx.delete(ctx.db.collection(C.categorySlugs).doc(before.slug));
        tx.create(ctx.db.collection(C.categorySlugs).doc(changes.slug), { categoryId: ref.id });
      }
      tx.set(ref, next);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'category.updated', resourceType: 'category', resourceId: ref.id, before: categoryDto(ref.id, before), after: categoryDto(ref.id, next) });
      return categoryDto(ref.id, next);
    });
    return { data: after };
  });

  route('GET', '/admin/products', async ctx => {
    await requireStaff(ctx, 'catalogue:read');
    const { query, db } = ctx;
    const limit = parseLimit(query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(query.get('cursor') ?? undefined, 2);
    const status = query.get('status');
    if (status && !PRODUCT_STATUSES.includes(status)) fail('validation_failed', 'The status filter is invalid.', { fieldErrors: { status: 'Unknown status.' } });
    const q = query.get('q')?.trim();
    const store = query.get('store');
    if (store && !['retail', 'hire_purchase'].includes(store)) fail('validation_failed', 'The store filter is invalid.', { fieldErrors: { store: 'Use retail or hire_purchase.' } });
    const snap = await (status ? db.collection(C.products).where('publishStatus', '==', status) : db.collection(C.products)).get();
    // Every product is sold in the retail store; store=hire_purchase narrows to the eligible ones.
    const docs = snap.docs.filter(doc => (!q || matches(q, doc.data().title, doc.data().slug)) && (store !== 'hire_purchase' || doc.data().hirePurchaseEnabled)).map(doc => ({ id: doc.id, title: doc.data().title, doc }));
    const page = paginateByTitle(docs, cursor, limit);
    return { data: { items: await adminProductDtos(db, page.items.map(item => item.doc)), nextCursor: page.nextCursor } };
  });

  route('GET', '/admin/products/:id', async ctx => {
    await requireStaff(ctx, 'catalogue:read');
    const doc = await ctx.db.collection(C.products).doc(ctx.params.id).get();
    if (!doc.exists) fail('not_found', 'Product not found.');
    return { data: (await adminProductDtos(ctx.db, [doc]))[0] };
  });

  route('POST', '/admin/products', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, { ...productSpec, hirePurchase: shape(hirePurchaseSpec) }, { optional: ['tagline', 'brand', 'specifications', 'images', 'illustration', 'description', 'hirePurchase'] });
    // Marking a product for the hire-purchase store while adding it needs the same permission and reason as changing it later.
    const hirePurchaseEnabled = input.hirePurchase?.enabled === true;
    if (hirePurchaseEnabled && !staff.permissions.includes('catalogue:hire_purchase')) {
      fail('forbidden', 'An approver marks hire-purchase eligibility. Create the product without it and ask an approver to enable it.');
    }
    if (hirePurchaseEnabled && !input.hirePurchase.reason) {
      fail('validation_failed', 'Some details need attention.', { fieldErrors: { 'hirePurchase.reason': 'Give a reason for making this product eligible.' } });
    }
    const id = newId('prd');
    const at = now();
    const product = {
      slug: input.slug, title: input.title, description: input.description ?? '', tagline: input.tagline ?? null, categoryId: input.categoryId,
      brand: input.brand ?? null, specifications: input.specifications ?? [], images: input.images ?? [], illustration: input.illustration ?? null,
      publishStatus: 'draft', hirePurchaseEnabled, illustrative: false, version: 1, createdAt: at, updatedAt: at,
    };
    await transaction(ctx.db, async tx => {
      const slugRef = ctx.db.collection(C.productSlugs).doc(input.slug);
      await ensureCategory(tx, ctx.db, input.categoryId);
      await ensureFree(tx, slugRef, 'slug');
      tx.create(slugRef, { productId: id });
      tx.create(ctx.db.collection(C.products).doc(id), product);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'product.created', resourceType: 'product', resourceId: id, after: productFields(id, product) });
      if (hirePurchaseEnabled) {
        recordAudit(ctx.db, tx, {
          ...auditFrom(ctx, staff), action: 'product.hire_purchase_changed', resourceType: 'product', resourceId: id,
          before: { hirePurchaseEnabled: false }, after: { hirePurchaseEnabled: true }, metadata: { reason: input.hirePurchase.reason },
        });
      }
    });
    return { status: 201, data: await adminProductDto(ctx.db, id) };
  });

  route('PATCH', '/admin/products/:id', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...productSpec, expectedVersion }, { partial: true });
    requireVersion(version);
    if (!Object.keys(changes).length) fail('validation_failed', 'Nothing to update.');
    await transaction(ctx.db, async tx => {
      const snap = await loadProduct(tx, ctx.db, ctx.params.id);
      const before = snap.data();
      const slugChanged = changes.slug && changes.slug !== before.slug;
      if (slugChanged) {
        // Changing a live URL would break links customers already have.
        if (before.publishStatus === 'published') fail('slug_locked', 'Unpublish the product before changing its web address.');
        await ensureFree(tx, ctx.db.collection(C.productSlugs).doc(changes.slug), 'slug');
      }
      if (changes.categoryId) await ensureCategory(tx, ctx.db, changes.categoryId);
      const next = { ...before, ...changes, version: before.version + 1, updatedAt: now() };
      if (next.publishStatus === 'published') {
        const errors = await publishReadiness(ctx.db, next, tx);
        if (Object.keys(errors).length) fail('not_ready', 'A published product must stay complete.', { fieldErrors: errors });
      }
      staleUnless(before.version === version);
      if (slugChanged) {
        tx.delete(ctx.db.collection(C.productSlugs).doc(before.slug));
        tx.create(ctx.db.collection(C.productSlugs).doc(changes.slug), { productId: snap.id });
      }
      tx.set(snap.ref, next);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'product.updated', resourceType: 'product', resourceId: snap.id, before: productFields(snap.id, before), after: productFields(snap.id, next) });
    });
    return { data: await adminProductDto(ctx.db, ctx.params.id) };
  });

  route('POST', '/admin/products/:id/transitions', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:publish');
    const input = validate(ctx.body, { action: oneOf(Object.keys(PRODUCT_TRANSITIONS)), expectedVersion, reason: str({ max: 500 }) }, { optional: ['reason'] });
    await transaction(ctx.db, async tx => {
      const snap = await loadProduct(tx, ctx.db, ctx.params.id);
      const before = snap.data();
      const transition = PRODUCT_TRANSITIONS[input.action];
      if (!transition.from.includes(before.publishStatus)) {
        fail('invalid_transition', `A ${before.publishStatus} product cannot be ${input.action === 'restore' ? 'restored' : `${input.action}ed`}.`);
      }
      if (transition.to === 'published') {
        const errors = await publishReadiness(ctx.db, before, tx);
        if (Object.keys(errors).length) fail('not_ready', 'This product is not ready to publish.', { fieldErrors: errors });
      }
      staleUnless(before.version === input.expectedVersion);
      tx.update(snap.ref, { publishStatus: transition.to, version: before.version + 1, updatedAt: now() });
      recordAudit(ctx.db, tx, {
        ...auditFrom(ctx, staff), action: `product.${input.action}`, resourceType: 'product', resourceId: snap.id,
        before: { publishStatus: before.publishStatus }, after: { publishStatus: transition.to }, metadata: input.reason ? { reason: input.reason } : null,
      });
    });
    return { data: await adminProductDto(ctx.db, ctx.params.id) };
  });

  // Hire-purchase eligibility is a policy decision, so it has its own permission and a mandatory reason.
  route('POST', '/admin/products/:id/hire-purchase', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:hire_purchase');
    const input = validate(ctx.body, { enabled: bool(), expectedVersion, reason: str({ min: 3, max: 500 }) });
    await transaction(ctx.db, async tx => {
      const snap = await loadProduct(tx, ctx.db, ctx.params.id);
      const before = snap.data();
      staleUnless(before.version === input.expectedVersion);
      tx.update(snap.ref, { hirePurchaseEnabled: input.enabled, version: before.version + 1, updatedAt: now() });
      recordAudit(ctx.db, tx, {
        ...auditFrom(ctx, staff), action: 'product.hire_purchase_changed', resourceType: 'product', resourceId: snap.id,
        before: { hirePurchaseEnabled: before.hirePurchaseEnabled }, after: { hirePurchaseEnabled: input.enabled }, metadata: { reason: input.reason },
      });
    });
    return { data: await adminProductDto(ctx.db, ctx.params.id) };
  });

  route('POST', '/admin/products/:id/variants', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const input = validate(ctx.body, variantSpec, { optional: ['attributes', 'retailPriceMinor', 'currency', 'active'] });
    const id = newId('var');
    const at = now();
    const variant = { attributes: {}, retailPriceMinor: null, currency: null, active: true, ...input, productId: ctx.params.id, version: 1, createdAt: at, updatedAt: at };
    await transaction(ctx.db, async tx => {
      await loadProduct(tx, ctx.db, ctx.params.id);
      const skuRef = ctx.db.collection(C.skus).doc(variant.sku);
      await ensureFree(tx, skuRef, 'sku');
      await checkPrice(ctx.db, tx, variant);
      tx.create(skuRef, { variantId: id, productId: ctx.params.id, onHand: 0, reserved: 0, updatedAt: at });
      tx.create(ctx.db.collection(C.variants).doc(id), variant);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'variant.created', resourceType: 'variant', resourceId: id, after: variantDto(id, variant), metadata: { productId: ctx.params.id } });
    });
    return { status: 201, data: variantDto(id, variant) };
  });

  route('PATCH', '/admin/variants/:id', async ctx => {
    const staff = await requireStaff(ctx, 'catalogue:write');
    const { sku: _immutable, ...editable } = variantSpec;
    const { expectedVersion: version, ...changes } = validate(ctx.body, { ...editable, expectedVersion }, { partial: true });
    requireVersion(version);
    if (!Object.keys(changes).length) fail('validation_failed', 'Nothing to update.');
    const id = ctx.params.id;
    const after = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.variants).doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not_found', 'Variant not found.');
      const before = snap.data();
      const next = { ...before, ...changes, version: before.version + 1, updatedAt: now() };
      if ('retailPriceMinor' in changes || 'currency' in changes) await checkPrice(ctx.db, tx, next);
      const stock = (await stockLevels(ctx.db, [before.sku], tx)).get(before.sku);
      staleUnless(before.version === version);
      tx.set(ref, next);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'variant.updated', resourceType: 'variant', resourceId: id, before: variantDto(id, before, stock), after: variantDto(id, next, stock) });
      return variantDto(id, next, stock);
    });
    return { data: after };
  });
}
