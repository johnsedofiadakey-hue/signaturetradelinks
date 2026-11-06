// Staff view of hire purchase agreements, payments taken in person, and ending an agreement.
import { AGREEMENT_STATUSES } from '../../../shared/contract.js';
import { markInstalmentPaid, nextInstalment } from '../agreements.js';
import { auditFrom, recordAudit } from '../audit.js';
import { requireStaff } from '../auth.js';
import { C, newId, now, transaction } from '../firestore.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';
import { int, oneOf, str, validate } from '../validate.js';
import { agreementDto } from './hire-purchase-buying.js';

const adminDto = agreement => ({
  ...agreementDto(agreement),
  applicationId: agreement.uid,
  attention: agreement.attention ?? null,
  cancelNote: agreement.cancelNote ?? null,
});

async function loadForChange(ctx, tx, expectedVersion) {
  const snap = await tx.get(ctx.db.collection(C.hpAgreements).doc(ctx.params.id));
  if (!snap.exists) fail('not_found', 'Agreement not found.');
  if (snap.data().version !== expectedVersion) fail('stale_version', 'This agreement was changed by someone else. Reload to see the latest version.');
  return snap;
}

export function registerAdminAgreements(route) {
  route('GET', '/admin/agreements', async ctx => {
    await requireStaff(ctx, 'agreements:read');
    const limit = parseLimit(ctx.query.get('limit'), { fallback: 50, max: 100 });
    const cursor = decodeCursor(ctx.query.get('cursor') ?? undefined, 1);
    const status = ctx.query.get('status');
    if (status && !AGREEMENT_STATUSES.includes(status)) fail('validation_failed', 'Unknown status.', { fieldErrors: { status: 'Unknown status.' } });
    let query = ctx.db.collection(C.hpAgreements);
    if (status) query = query.where('status', '==', status);
    query = query.orderBy('sortKey', 'desc');
    if (cursor) query = query.startAfter(cursor[0]);
    const snap = await query.limit(limit + 1).get();
    const page = snap.docs.slice(0, limit);
    return { data: { items: page.map(doc => adminDto(doc.data())), nextCursor: snap.docs.length > limit ? encodeCursor([page.at(-1).data().sortKey]) : null } };
  }, { skipBody: true });

  route('GET', '/admin/agreements/:id', async ctx => {
    const staff = await requireStaff(ctx, 'agreements:read');
    const agreement = (await ctx.db.collection(C.hpAgreements).doc(ctx.params.id).get()).data();
    if (!agreement) fail('not_found', 'Agreement not found.');
    await recordAudit(ctx.db, null, { ...auditFrom(ctx, staff), action: 'agreement.viewed', resourceType: 'hp_agreement', resourceId: ctx.params.id });
    return { data: adminDto(agreement) };
  }, { skipBody: true });

  // Cash, or mobile money or a transfer outside Paystack. It always covers the next instalment in full.
  route('POST', '/admin/agreements/:id/payments', async ctx => {
    const staff = await requireStaff(ctx, 'agreements:payments');
    const input = validate(ctx.body, { method: oneOf(['cash', 'mobile_money', 'bank_transfer', 'other']), note: str({ max: 300 }), expectedVersion: int({ min: 1 }) });
    await transaction(ctx.db, async tx => {
      const snap = await loadForChange(ctx, tx, input.expectedVersion);
      const agreement = snap.data();
      const next = nextInstalment(agreement);
      if (agreement.status !== 'active' || !next) fail('invalid_transition', 'There is nothing to record on this agreement right now.');
      markInstalmentPaid(ctx.db, tx, snap, next.number, { reference: newId('manual'), method: input.method, amountMinor: next.amountMinor, source: `staff: ${input.note}` }, auditFrom(ctx, staff));
    });
    return { data: adminDto((await ctx.db.collection(C.hpAgreements).doc(ctx.params.id).get()).data()) };
  });

  // Only records that it ended. Goods, refunds and any amount owed are handled outside the system, on legal advice.
  route('POST', '/admin/agreements/:id/cancel', async ctx => {
    const staff = await requireStaff(ctx, 'applications:decide');
    const input = validate(ctx.body, { reason: str({ max: 1000 }), expectedVersion: int({ min: 1 }) });
    await transaction(ctx.db, async tx => {
      const snap = await loadForChange(ctx, tx, input.expectedVersion);
      const agreement = snap.data();
      if (agreement.status !== 'active') fail('invalid_transition', 'Only an active agreement can be ended. Cancel an unpaid deposit from its order.');
      tx.update(snap.ref, { status: 'cancelled', cancelReason: 'ended_by_staff', cancelNote: input.reason, pendingPayment: null, version: agreement.version + 1, updatedAt: now() });
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, staff), action: 'agreement.cancelled', resourceType: 'hp_agreement', resourceId: ctx.params.id, before: { status: 'active' }, after: { status: 'cancelled' } });
    });
    return { data: adminDto((await ctx.db.collection(C.hpAgreements).doc(ctx.params.id).get()).data()) };
  });
}
