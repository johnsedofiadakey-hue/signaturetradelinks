import { SETTINGS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { getSetting, stockLevels } from '../catalogue.js';
import { json, now, transaction } from '../db.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { currency, int, nullable, validate } from '../validate.js';

const SETTING_RULES = { 'store.currency': currency() };

const settingDto = (key, row) => ({
  key, description: SETTINGS[key].description, value: row ? JSON.parse(row.value) : null, configured: Boolean(row && JSON.parse(row.value) !== null),
  version: row?.version ?? 0, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null,
});

export function registerAdminOperations(route) {
  // Counts straight from the database; no invented metrics.
  route('GET', '/admin/dashboard', ctx => {
    requireStaff(ctx, 'dashboard:read');
    const byStatus = Object.fromEntries(ctx.db.prepare('SELECT publish_status, COUNT(*) AS n FROM products GROUP BY publish_status').all().map(r => [r.publish_status, r.n]));
    const variants = ctx.db.prepare('SELECT sku, active, retail_price_minor FROM variants').all();
    const stock = stockLevels(ctx.db);
    const active = variants.filter(v => v.active);
    const settingsMissing = Object.keys(SETTINGS).filter(key => !ctx.db.prepare('SELECT 1 FROM settings WHERE key = ? AND value <> \'null\'').get(key));
    return {
      data: {
        generatedAt: now(),
        storeCurrency: getSetting(ctx.db, 'store.currency'),
        products: { draft: byStatus.draft ?? 0, published: byStatus.published ?? 0, archived: byStatus.archived ?? 0 },
        variants: {
          active: active.length,
          unpriced: active.filter(v => v.retail_price_minor === null).length,
          outOfStock: active.filter(v => (stock.get(v.sku)?.available ?? 0) <= 0).length,
        },
        settingsMissing,
        // Modules that need owner decisions before they can be built or switched on.
        unavailable: ['retail_checkout', 'hire_purchase_applications', 'agreements', 'payments'],
      },
    };
  });

  route('GET', '/admin/settings', ctx => {
    requireStaff(ctx, 'settings:manage');
    return { data: Object.keys(SETTINGS).map(key => settingDto(key, ctx.db.prepare('SELECT * FROM settings WHERE key = ?').get(key))) };
  });

  route('PUT', '/admin/settings/:key', ctx => {
    const staff = requireStaff(ctx, 'settings:manage');
    const key = ctx.params.key;
    if (!SETTINGS[key]) fail('not_found', 'Unknown setting.');
    const input = validate(ctx.body, { value: nullable(SETTING_RULES[key]), expectedVersion: int({ min: 0 }) });
    return transaction(ctx.db, () => {
      const row = ctx.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
      if ((row?.version ?? 0) !== input.expectedVersion) fail('stale_version', 'This setting was changed by someone else. Reload and try again.');
      if (key === 'store.currency') {
        const mismatched = ctx.db.prepare('SELECT COUNT(*) AS n FROM variants WHERE currency IS NOT NULL AND currency IS NOT ?').get(input.value).n;
        if (mismatched) fail('currency_in_use', `${mismatched} priced variant(s) use another currency. Clear or re-price them first.`);
      }
      const at = now();
      if (row) ctx.db.prepare('UPDATE settings SET value = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE key = ?').run(JSON.stringify(input.value), at, staff.id, key);
      else ctx.db.prepare('INSERT INTO settings (key, value, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)').run(key, JSON.stringify(input.value), at, staff.id);
      recordAudit(ctx.db, { ...auditFrom(ctx, staff), action: 'setting.changed', resourceType: 'setting', resourceId: key, before: { value: row ? JSON.parse(row.value) : null }, after: { value: input.value } });
      return { data: settingDto(key, ctx.db.prepare('SELECT * FROM settings WHERE key = ?').get(key)) };
    });
  });

  route('GET', '/admin/audit-events', ctx => {
    requireStaff(ctx, 'audit:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 2);
    const where = [];
    const params = [];
    for (const [param, column] of [['resourceType', 'resource_type'], ['resourceId', 'resource_id'], ['actorId', 'actor_id']]) {
      const value = ctx.query.get(param);
      if (value) { where.push(`${column} = ?`); params.push(value); }
    }
    if (cursor) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); params.push(cursor[0], cursor[0], cursor[1]); }
    const rows = ctx.db.prepare(`
      SELECT a.*, s.display_name AS actor_name FROM audit_events a LEFT JOIN staff s ON s.id = a.actor_id
      ${where.length ? `WHERE ${where.map(w => `a.${w}`).join(' AND ')}` : ''}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: {
        items: page.map(row => ({
          id: row.id, actorType: row.actor_type, actorId: row.actor_id, actorName: row.actor_name, action: row.action,
          resourceType: row.resource_type, resourceId: row.resource_id, before: json(row.before_state), after: json(row.after_state),
          metadata: json(row.metadata), requestId: row.request_id, createdAt: row.created_at,
        })),
        nextCursor: rows.length > limit ? encodeCursor([last.created_at, last.id]) : null,
      },
    };
  });
}
