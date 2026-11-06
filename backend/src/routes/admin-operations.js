import { SETTINGS } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { getSetting, stockOf } from '../catalogue.js';
import { C, now, transaction } from '../firestore.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { SLUG, arrayOf, currency, int, nullable, shape, str, validate } from '../validate.js';

const SETTING_RULES = {
  'store.currency': currency(),
  'checkout.deliveryZones': arrayOf(shape({
    id: str({ max: 60, pattern: SLUG, patternMessage: 'Use lowercase letters, numbers and hyphens.' }),
    name: str({ max: 80 }),
    feeMinor: int({ min: 0, max: 100_000_000 }),
  }), { max: 50 }),
  'checkout.pickup': shape({ address: str({ max: 300 }), hours: str({ max: 200 }) }),
  'checkout.reservationMinutes': int({ min: 5, max: 1440 }),
  'checkout.returnsPolicy': str({ max: 2000 }),
  'hirePurchase.plans': arrayOf(shape({
    id: str({ max: 60, pattern: SLUG, patternMessage: 'Use lowercase letters, numbers and hyphens.' }),
    name: str({ max: 80 }),
    // A deposit is required because a payment of nothing can't be taken, and it starts the agreement.
    depositBasisPoints: int({ min: 100, max: 9000 }),
    instalments: int({ min: 1, max: 60 }),
    chargeBasisPoints: int({ min: 0, max: 30_000 }),
  }), { max: 20 }),
  'hirePurchase.agreementTerms': str({ max: 30_000 }),
  'hirePurchase.privacyNotice': str({ max: 8000 }),
  'hirePurchase.declaration': str({ max: 8000 }),
};

const settingDto = (key, data) => ({
  key, description: SETTINGS[key].description, value: data?.value ?? null, configured: (data?.value ?? null) !== null,
  version: data?.version ?? 0, updatedAt: data?.updatedAt ?? null, updatedBy: data?.updatedBy ?? null,
});

// Filter combinations with a matching composite index in firestore.indexes.json.
const AUDIT_FILTERS = [[], ['resourceType'], ['resourceId'], ['actorId'], ['resourceType', 'resourceId']];

export function registerAdminOperations(route) {
  // Counts straight from the database; no invented metrics.
  route('GET', '/admin/dashboard', async ctx => {
    await requireStaff(ctx, 'dashboard:read');
    const [products, variants, skus, settings] = await Promise.all(['products', 'variants', 'skus', 'settings'].map(name => ctx.db.collection(C[name]).get()));
    const byStatus = { draft: 0, published: 0, archived: 0 };
    for (const doc of products.docs) byStatus[doc.data().publishStatus] += 1;
    const stock = new Map(skus.docs.map(doc => [doc.id, stockOf(doc.data())]));
    const active = variants.docs.map(doc => doc.data()).filter(v => v.active);
    const configured = new Set(settings.docs.filter(doc => doc.data().value !== null).map(doc => doc.id));
    return {
      data: {
        generatedAt: now(),
        storeCurrency: await getSetting(ctx.db, 'store.currency'),
        products: byStatus,
        variants: {
          active: active.length,
          unpriced: active.filter(v => v.retailPriceMinor === null).length,
          outOfStock: active.filter(v => (stock.get(v.sku)?.available ?? 0) <= 0).length,
        },
        settingsMissing: Object.keys(SETTINGS).filter(key => !configured.has(key)),
      },
    };
  });

  route('GET', '/admin/settings', async ctx => {
    await requireStaff(ctx, 'settings:manage');
    const snaps = await ctx.db.getAll(...Object.keys(SETTINGS).map(key => ctx.db.collection(C.settings).doc(key)));
    return { data: snaps.map(snap => settingDto(snap.id, snap.data())) };
  });

  route('PUT', '/admin/settings/:key', async ctx => {
    const staff = await requireStaff(ctx, 'settings:manage');
    const key = ctx.params.key;
    if (!SETTINGS[key]) fail('not_found', 'Unknown setting.');
    const input = validate(ctx.body, { value: nullable(SETTING_RULES[key]), expectedVersion: int({ min: 0 }) });
    const result = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.settings).doc(key);
      const snap = await tx.get(ref);
      const before = snap.data();
      if (key === 'store.currency') {
        const variants = await tx.get(ctx.db.collection(C.variants));
        const mismatched = variants.docs.filter(doc => doc.data().currency !== null && doc.data().currency !== input.value).length;
        if (mismatched) fail('currency_in_use', `${mismatched} priced variant(s) use another currency. Clear or re-price them first.`);
      }
      if ((before?.version ?? 0) !== input.expectedVersion) fail('stale_version', 'This setting was changed by someone else. Reload and try again.');
      const next = { value: input.value, version: (before?.version ?? 0) + 1, updatedAt: now(), updatedBy: staff.id };
      tx.set(ref, next);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'setting.changed', resourceType: 'setting', resourceId: key, before: { value: before?.value ?? null }, after: { value: input.value } });
      return settingDto(key, next);
    });
    return { data: result };
  });

  route('GET', '/admin/audit-events', async ctx => {
    await requireStaff(ctx, 'audit:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 1);
    const filters = ['resourceType', 'resourceId', 'actorId'].filter(name => ctx.query.get(name));
    if (!AUDIT_FILTERS.some(combo => combo.join() === filters.join())) {
      fail('validation_failed', 'Use one filter, or resourceType with resourceId.', { fieldErrors: { filters: 'Unsupported filter combination.' } });
    }
    let query = ctx.db.collection(C.auditEvents);
    for (const name of filters) query = query.where(name, '==', ctx.query.get(name));
    query = query.orderBy('sortKey', 'desc');
    if (cursor) query = query.startAfter(cursor[0]);
    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    const actorIds = [...new Set(page.map(doc => doc.data().actorId).filter(Boolean))];
    const actors = actorIds.length ? await ctx.db.getAll(...actorIds.map(id => ctx.db.collection(C.staff).doc(id))) : [];
    const names = new Map(actors.filter(a => a.exists).map(a => [a.id, a.data().displayName]));
    return {
      data: {
        items: page.map(doc => {
          const e = doc.data();
          return {
            id: doc.id, actorType: e.actorType, actorId: e.actorId, actorName: names.get(e.actorId) ?? null, action: e.action,
            resourceType: e.resourceType, resourceId: e.resourceId, before: e.before, after: e.after, metadata: e.metadata,
            requestId: e.requestId, createdAt: e.createdAt,
          };
        }),
        nextCursor: snap.docs.length > limit ? encodeCursor([page.at(-1).data().sortKey]) : null,
      },
    };
  });
}
