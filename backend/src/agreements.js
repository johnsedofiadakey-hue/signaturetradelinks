// Hire purchase agreements: the schedule, activation when the deposit is paid, and instalment payments.
// Plans, charges and the agreement wording all come from owner settings. Nothing here sets commercial terms.
import { recordAudit } from './audit.js';
import { C, newId, now, read, readAll } from './firestore.js';

export const OPEN_AGREEMENT_STATUSES = ['awaiting_deposit', 'active'];

/** Same day each month, or the last day of a shorter month. */
export function addMonths(date, months) {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export const outstandingOf = agreement => agreement.instalments.filter(item => item.status !== 'paid').reduce((sum, item) => sum + item.amountMinor, 0);

/** What is left of an approved amount: the unpaid balance on every open agreement counts against it. */
export const availableLimit = (limitMinor, agreements) => limitMinor - agreements.filter(a => OPEN_AGREEMENT_STATUSES.includes(a.status)).reduce((sum, a) => sum + outstandingOf(a), 0);

export async function loadBuyingSettings(db, tx) {
  const snaps = await readAll(db, ['hirePurchase.plans', 'hirePurchase.agreementTerms'].map(key => db.collection(C.settings).doc(key)), tx);
  return { plans: snaps[0].data()?.value ?? [], terms: snaps[1].data()?.value ?? null, termsVersion: snaps[1].data()?.version ?? 0 };
}

export const nextInstalment = agreement => agreement.instalments.find(item => item.status !== 'paid') ?? null;

/** The deposit is in: the agreement starts and the instalment dates are fixed from today. */
export function activateAgreement(db, tx, snap, at) {
  const agreement = snap.data();
  if (agreement.status === 'active' || agreement.status === 'completed') return;
  const today = at.slice(0, 10);
  const instalments = agreement.instalments.map(item => ({ ...item, dueDate: addMonths(today, item.number) }));
  tx.update(snap.ref, { status: 'active', instalments, activatedAt: at, cancelReason: null, version: agreement.version + 1, updatedAt: at });
  recordAudit(db, tx, { actor: null, action: 'agreement.activated', resourceType: 'hp_agreement', resourceId: snap.id, before: { status: agreement.status }, after: { status: 'active' } });
}

/** When an unpaid deposit order ends, its agreement ends with it. Reads now; call the returned function with the other writes. */
export async function cancelAgreementForOrder(db, tx, order, reason) {
  if (!order.agreementId) return () => {};
  const snap = await tx.get(db.collection(C.hpAgreements).doc(order.agreementId));
  const agreement = snap.data();
  if (agreement?.status !== 'awaiting_deposit') return () => {};
  return () => {
    tx.update(snap.ref, { status: 'cancelled', cancelReason: reason, version: agreement.version + 1, updatedAt: now() });
    recordAudit(db, tx, { actor: null, action: 'agreement.cancelled', resourceType: 'hp_agreement', resourceId: snap.id, before: { status: agreement.status }, after: { status: 'cancelled' }, metadata: { reason } });
  };
}

const INSTALMENT_REFERENCE = /^HPI-(\d+)-[A-Z0-9]+-(HP-[A-Z0-9]+)$/;
export const isInstalmentReference = reference => INSTALMENT_REFERENCE.test(reference);
export const newInstalmentReference = (agreementId, number) => `HPI-${number}-${newId('p').slice(2, 14).toUpperCase()}-${agreementId}`;

/** Mark one instalment paid and close the agreement when it was the last. Caller is inside a transaction, after reads. */
export function markInstalmentPaid(db, tx, snap, number, payment, audit) {
  const agreement = snap.data();
  const at = now();
  const instalments = agreement.instalments.map(item => (item.number === number ? { ...item, status: 'paid', paidAt: payment.paidAt ?? at, paymentMethod: payment.method, paymentReference: payment.reference } : item));
  const completed = instalments.every(item => item.status === 'paid');
  tx.update(snap.ref, {
    instalments, status: completed ? 'completed' : agreement.status, completedAt: completed ? at : null,
    pendingPayment: agreement.pendingPayment?.number === number ? null : agreement.pendingPayment ?? null,
    version: agreement.version + 1, updatedAt: at,
  });
  tx.set(db.collection(C.payments).doc(payment.reference), {
    reference: payment.reference, agreementId: snap.id, instalment: number, provider: payment.method, providerId: payment.providerId ?? null,
    amountMinor: payment.amountMinor, currency: agreement.currency, paidAt: payment.paidAt ?? at, source: payment.source, recordedAt: at,
  });
  recordAudit(db, tx, { ...audit, action: 'agreement.instalment_paid', resourceType: 'hp_agreement', resourceId: snap.id, after: { instalment: number, amountMinor: payment.amountMinor, status: completed ? 'completed' : agreement.status }, metadata: { method: payment.method } });
}

/** Record an instalment Paystack has verified. Safe to run twice: webhooks and returns from Paystack may both arrive. */
export function applyInstalmentPayment(db, { reference, amountMinor, currency, providerId, paidAt, source }) {
  const [, numberText, agreementId] = INSTALMENT_REFERENCE.exec(reference);
  const number = Number(numberText);
  return db.runTransaction(async tx => {
    const snap = await tx.get(db.collection(C.hpAgreements).doc(agreementId));
    const recorded = await read(db.collection(C.payments).doc(reference), tx);
    const agreement = snap.data();
    if (!agreement) return { applied: false, reason: 'unknown_agreement' };
    if (recorded.exists) return { applied: false, reason: 'already_recorded' };
    const instalment = agreement.instalments.find(item => item.number === number);
    const attention = reason => {
      tx.update(snap.ref, { attention: reason, version: agreement.version + 1, updatedAt: now() });
      recordAudit(db, tx, { actor: null, action: 'agreement.payment_attention', resourceType: 'hp_agreement', resourceId: agreementId, metadata: { reason, reference, amountMinor, currency } });
      return { applied: false, reason };
    };
    // Money that doesn't match never counts as paid. It goes to staff instead.
    if (!instalment || amountMinor !== instalment.amountMinor || currency !== agreement.currency) return attention('payment_mismatch');
    if (instalment.status === 'paid') return attention('duplicate_payment');
    markInstalmentPaid(db, tx, snap, number, { reference, method: 'paystack', providerId, paidAt, amountMinor, source }, { actor: null });
    return { applied: true };
  });
}
