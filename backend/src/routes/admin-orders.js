// Staff view of retail orders. Customer details are limited to roles with orders:read.
import { ORDER_FULFILMENT_TRANSITIONS, ORDER_PAYMENT_STATUSES } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { C, now, transaction } from '../firestore.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { cancelUnpaidOrder } from '../orders.js';
import { int, oneOf, str, validate } from '../validate.js';
import { publicOrderDto } from './checkout.js';

const adminOrderDto = order => ({
  ...publicOrderDto(order),
  agreementId: order.agreementId ?? null,
  stockHeld: order.stockHeld,
  stockDeducted: order.stockDeducted,
  attention: order.attention,
  version: order.version,
  updatedAt: order.updatedAt,
});

export function registerAdminOrders(route) {
  route('GET', '/admin/orders', async ctx => {
    await requireStaff(ctx, 'orders:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 1);
    const status = ctx.query.get('paymentStatus');
    if (status && !ORDER_PAYMENT_STATUSES.includes(status)) fail('validation_failed', 'The payment filter is invalid.', { fieldErrors: { paymentStatus: 'Unknown status.' } });
    let query = ctx.db.collection(C.orders);
    if (status) query = query.where('paymentStatus', '==', status);
    query = query.orderBy('sortKey', 'desc');
    if (cursor) query = query.startAfter(cursor[0]);
    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    return { data: { items: page.map(doc => adminOrderDto(doc.data())), nextCursor: snap.docs.length > limit ? encodeCursor([page.at(-1).data().sortKey]) : null } };
  });

  route('GET', '/admin/orders/:reference', async ctx => {
    await requireStaff(ctx, 'orders:read');
    const snap = await ctx.db.collection(C.orders).doc(ctx.params.reference).get();
    if (!snap.exists) fail('not_found', 'Order not found.');
    return { data: adminOrderDto(snap.data()) };
  });

  // Goods only move once money has been verified.
  route('POST', '/admin/orders/:reference/fulfilment', async ctx => {
    const staff = await requireStaff(ctx, 'orders:fulfil');
    const input = validate(ctx.body, { action: oneOf(Object.keys(ORDER_FULFILMENT_TRANSITIONS)), expectedVersion: int({ min: 1 }) });
    const transition = ORDER_FULFILMENT_TRANSITIONS[input.action];
    const ref = ctx.db.collection(C.orders).doc(ctx.params.reference);
    await transaction(ctx.db, async tx => {
      const snap = await tx.get(ref);
      const order = snap.data();
      if (!order) fail('not_found', 'Order not found.');
      if (order.version !== input.expectedVersion) fail('stale_version', 'This order was changed by someone else. Reload to see the latest version.');
      if (order.paymentStatus !== 'paid') fail('invalid_transition', 'Only paid orders can be fulfilled.');
      if (order.fulfilmentStatus !== transition.from) fail('invalid_transition', `This order is ${order.fulfilmentStatus.replace('_', ' ')}.`);
      tx.update(ref, { fulfilmentStatus: transition.to, version: order.version + 1, updatedAt: now() });
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: `order.${input.action}`, resourceType: 'order', resourceId: ctx.params.reference, before: { fulfilmentStatus: order.fulfilmentStatus }, after: { fulfilmentStatus: transition.to } });
    });
    return { data: adminOrderDto((await ref.get()).data()) };
  });

  route('POST', '/admin/orders/:reference/cancel', async ctx => {
    const staff = await requireStaff(ctx, 'orders:fulfil');
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }), reason: str({ min: 3, max: 500 }) });
    await cancelUnpaidOrder(ctx.db, { reference: ctx.params.reference, staff, requestId: ctx.requestId, expectedVersion: input.expectedVersion, reason: input.reason });
    return { data: adminOrderDto((await ctx.db.collection(C.orders).doc(ctx.params.reference).get()).data()) };
  });
}
