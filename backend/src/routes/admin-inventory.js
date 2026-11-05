import { INVENTORY_REASONS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { stockOf } from '../catalogue.js';
import { C, newId, now, sortKey } from '../firestore.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { idempotent } from '../idempotency.js';
import { SKU, int, oneOf, str, validate } from '../validate.js';
import { matches } from './public.js';

const movementDto = (id, d) => ({
  id, sku: d.sku, quantity: d.quantity, reason: d.reason, sourceType: d.sourceType, note: d.note, actorId: d.actorId, createdAt: d.createdAt,
});

export function registerAdminInventory(route) {
  route('GET', '/admin/inventory', async ctx => {
    await requireStaff(ctx, 'inventory:read');
    const q = ctx.query.get('q')?.trim();
    const [variants, products, skus] = await Promise.all(['variants', 'products', 'skus'].map(name => ctx.db.collection(C[name]).get()));
    const productsById = new Map(products.docs.map(doc => [doc.id, doc.data()]));
    const stockBySku = new Map(skus.docs.map(doc => [doc.id, stockOf(doc.data())]));
    const items = variants.docs
      .map(doc => ({ id: doc.id, ...doc.data(), product: productsById.get(doc.data().productId) }))
      .filter(v => v.product && (!q || matches(q, v.sku, v.product.title)))
      .sort((a, b) => a.product.title.localeCompare(b.product.title) || a.sku.localeCompare(b.sku))
      .map(v => ({
        variantId: v.id, sku: v.sku, active: v.active, attributes: v.attributes,
        product: { id: v.productId, title: v.product.title, publishStatus: v.product.publishStatus }, ...stockBySku.get(v.sku) ?? stockOf(),
      }));
    return { data: { items, nextCursor: null } };
  });

  route('GET', '/admin/inventory/movements', async ctx => {
    await requireStaff(ctx, 'inventory:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 1);
    const sku = ctx.query.get('sku');
    let query = ctx.db.collection(C.inventoryMovements);
    if (sku) query = query.where('sku', '==', sku);
    query = query.orderBy('sortKey', 'desc');
    if (cursor) query = query.startAfter(cursor[0]);
    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    return {
      data: {
        items: page.map(doc => movementDto(doc.id, doc.data())),
        nextCursor: snap.docs.length > limit ? encodeCursor([page.at(-1).data().sortKey]) : null,
      },
    };
  });

  // Manual stock adjustments. Each is an immutable ledger entry; the SKU's counters move in the same transaction.
  route('POST', '/admin/inventory/movements', async ctx => {
    const staff = await requireStaff(ctx, 'inventory:adjust');
    const input = validate(ctx.body, {
      sku: str({ max: 40, pattern: SKU, patternMessage: 'Invalid SKU.' }),
      quantity: int({ min: -100_000, max: 100_000, nonZero: true }),
      reason: oneOf(Object.keys(INVENTORY_REASONS)),
      note: str({ max: 500 }),
    }, { optional: ['note'] });
    const rule = INVENTORY_REASONS[input.reason];
    const fieldErrors = {};
    if (rule.sign > 0 && input.quantity < 0) fieldErrors.quantity = 'Received stock must be a positive quantity.';
    if (rule.sign < 0 && input.quantity > 0) fieldErrors.quantity = 'This reason removes stock, so use a negative quantity.';
    if (rule.noteRequired && !input.note) fieldErrors.note = 'Explain this adjustment.';
    if (Object.keys(fieldErrors).length) fail('validation_failed', 'Some details need attention.', { fieldErrors });

    return idempotent(ctx, `${staff.id}:inventory.movement`, async (tx, key) => {
      const skuRef = ctx.db.collection(C.skus).doc(input.sku);
      const skuSnap = await tx.get(skuRef);
      if (!skuSnap.exists) fail('not_found', 'SKU not found.');
      const before = stockOf(skuSnap.data());
      // Never let on-hand stock drop below zero or below what checkouts have already reserved.
      if (before.onHand + input.quantity < before.reserved) fail('insufficient_stock', `Only ${before.available} available to remove.`);
      const after = stockOf({ ...skuSnap.data(), onHand: before.onHand + input.quantity });
      const id = newId('mov');
      const createdAt = now();
      const movement = {
        sku: input.sku, quantity: input.quantity, reason: input.reason, sourceType: 'manual_adjustment', sourceKey: `manual:${staff.id}:${key}`,
        note: input.note ?? null, actorId: staff.id, stockAfter: after.onHand, createdAt, sortKey: sortKey(createdAt, id),
      };
      tx.create(ctx.db.collection(C.inventoryMovements).doc(id), movement);
      tx.update(skuRef, { onHand: after.onHand, updatedAt: createdAt });
      recordAudit(ctx.db, tx, {
        ...auditFrom(ctx, staff), action: 'inventory.adjusted', resourceType: 'variant_stock', resourceId: input.sku,
        before, after, metadata: { movementId: id, quantity: input.quantity, reason: input.reason },
      });
      return { status: 201, data: { movement: movementDto(id, movement), stock: after } };
    });
  });
}
