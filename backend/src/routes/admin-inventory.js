import { INVENTORY_REASONS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { stockLevels } from '../catalogue.js';
import { newId, now } from '../db.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { idempotent } from '../idempotency.js';
import { SKU, int, oneOf, str, validate } from '../validate.js';
import { likePattern } from './public.js';

const movementDto = row => ({
  id: row.id, sku: row.sku, quantity: row.quantity, reason: row.reason, sourceType: row.source_type, note: row.note,
  actorId: row.actor_id, createdAt: row.created_at,
});

export function registerAdminInventory(route) {
  route('GET', '/admin/inventory', ctx => {
    requireStaff(ctx, 'inventory:read');
    const q = ctx.query.get('q')?.trim();
    const rows = ctx.db.prepare(`
      SELECT v.id, v.sku, v.active, v.attributes, p.id AS product_id, p.title, p.publish_status
      FROM variants v JOIN products p ON p.id = v.product_id
      ${q ? "WHERE lower(v.sku) LIKE ? ESCAPE '\\' OR lower(p.title) LIKE ? ESCAPE '\\'" : ''}
      ORDER BY lower(p.title), v.sku`).all(...(q ? [likePattern(q), likePattern(q)] : []));
    const stock = stockLevels(ctx.db, rows.map(r => r.sku));
    return {
      data: {
        items: rows.map(row => ({
          variantId: row.id, sku: row.sku, active: Boolean(row.active), attributes: JSON.parse(row.attributes),
          product: { id: row.product_id, title: row.title, publishStatus: row.publish_status }, ...stock.get(row.sku),
        })),
        nextCursor: null,
      },
    };
  });

  route('GET', '/admin/inventory/movements', ctx => {
    requireStaff(ctx, 'inventory:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 2);
    const where = [];
    const params = [];
    const sku = ctx.query.get('sku');
    if (sku) { where.push('sku = ?'); params.push(sku); }
    if (cursor) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); params.push(cursor[0], cursor[0], cursor[1]); }
    const rows = ctx.db.prepare(`SELECT * FROM inventory_movements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { data: { items: page.map(movementDto), nextCursor: rows.length > limit ? encodeCursor([last.created_at, last.id]) : null } };
  });

  // Manual stock adjustments. Each is an immutable ledger row; corrections are new rows, never edits.
  route('POST', '/admin/inventory/movements', ctx => {
    const staff = requireStaff(ctx, 'inventory:adjust');
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

    return idempotent(ctx, `${staff.id}:inventory.movement`, key => {
      if (!ctx.db.prepare('SELECT 1 FROM variants WHERE sku = ?').get(input.sku)) fail('not_found', 'SKU not found.');
      const before = stockLevels(ctx.db, [input.sku]).get(input.sku);
      // Never let on-hand stock drop below zero or below what checkouts have already reserved.
      if (before.onHand + input.quantity < before.reserved) {
        fail('insufficient_stock', `Only ${before.available} available to remove.`);
      }
      const id = newId('mov');
      ctx.db.prepare(`
        INSERT INTO inventory_movements (id, sku, quantity, reason, source_type, source_key, note, actor_id, created_at)
        VALUES (?, ?, ?, ?, 'manual_adjustment', ?, ?, ?, ?)`).run(id, input.sku, input.quantity, input.reason, `manual:${staff.id}:${key}`, input.note ?? null, staff.id, now());
      const after = stockLevels(ctx.db, [input.sku]).get(input.sku);
      recordAudit(ctx.db, {
        ...auditFrom(ctx, staff), action: 'inventory.adjusted', resourceType: 'variant_stock', resourceId: input.sku,
        before, after, metadata: { movementId: id, quantity: input.quantity, reason: input.reason },
      });
      return { status: 201, data: { movement: movementDto(ctx.db.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(id)), stock: after } };
    });
  });
}
