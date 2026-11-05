// Retail order rules: server-side pricing, stock holds, payment application and release of unpaid orders.
// Prices always come from the database; the browser only ever sends SKUs and quantities.
import { randomBytes } from 'node:crypto';
import { recordAudit } from './audit.js';
import { stockLevels, stockOf } from './catalogue.js';
import { C, newId, now, read, readAll, sha256, sortKey, transaction } from './firestore.js';
import { fail } from './http.js';

const CHECKOUT_SETTINGS = ['store.currency', 'checkout.deliveryZones', 'checkout.pickup', 'checkout.reservationMinutes', 'checkout.returnsPolicy'];

export async function loadCheckoutSettings(db, tx) {
  const snaps = await readAll(db, CHECKOUT_SETTINGS.map(key => db.collection(C.settings).doc(key)), tx);
  const [currency, deliveryZones, pickup, reservationMinutes, returnsPolicy] = snaps.map(snap => snap.data()?.value ?? null);
  return { currency, deliveryZones: deliveryZones ?? [], pickup, reservationMinutes, returnsPolicy };
}

/** What still blocks customers. Quoting needs prices and a way to receive goods; ordering needs everything. */
export function checkoutReadiness(settings, payments) {
  const quoteMissing = [];
  if (!settings.currency) quoteMissing.push('store.currency');
  if (!settings.deliveryZones.length && !settings.pickup) quoteMissing.push('checkout.deliveryZones');
  const missing = [...quoteMissing];
  if (!settings.reservationMinutes) missing.push('checkout.reservationMinutes');
  if (!settings.returnsPolicy) missing.push('checkout.returnsPolicy');
  if (!payments.configured) missing.push('payment_provider');
  return { canQuote: quoteMissing.length === 0, canOrder: missing.length === 0, missing };
}

function resolveFulfilment(fulfilment, settings) {
  if (fulfilment.method === 'pickup') {
    if (!settings.pickup) fail('validation_failed', 'Some details need attention.', { fieldErrors: { fulfilment: 'In-store collection is not available.' } });
    return { method: 'pickup', feeMinor: 0, pickup: settings.pickup };
  }
  const zone = settings.deliveryZones.find(z => z.id === fulfilment.zoneId);
  if (!zone) fail('validation_failed', 'Some details need attention.', { fieldErrors: { fulfilment: 'Choose a delivery area from the list.' } });
  return { method: 'delivery', feeMinor: zone.feeMinor, zoneId: zone.id, zoneName: zone.name };
}

/**
 * Price a basket from the database and check it can be sold right now.
 * Works inside a transaction (all reads, no writes) so an order is priced and reserved atomically.
 */
export async function priceBasket(db, { items, fulfilment }, settings, tx) {
  const quantities = new Map();
  for (const { sku, quantity } of items) quantities.set(sku, (quantities.get(sku) ?? 0) + quantity);
  const skus = [...quantities.keys()];

  const variantSnap = await read(db.collection(C.variants).where('sku', 'in', skus), tx);
  const variants = new Map(variantSnap.docs.map(doc => [doc.data().sku, doc.data()]));
  const productIds = [...new Set([...variants.values()].map(v => v.productId))];
  const productSnaps = await readAll(db, productIds.map(id => db.collection(C.products).doc(id)), tx);
  const products = new Map(productSnaps.map(snap => [snap.id, snap.data()]));
  const stock = await stockLevels(db, skus, tx);

  const lines = skus.map(sku => {
    const variant = variants.get(sku);
    const product = variant && products.get(variant.productId);
    const sellable = product?.publishStatus === 'published' && variant.active && variant.retailPriceMinor !== null && variant.currency === settings.currency;
    if (!sellable) fail('item_unavailable', 'An item in your bag is no longer available.', { fieldErrors: { [sku]: 'No longer available.' } });
    const quantity = quantities.get(sku);
    const available = stock.get(sku)?.available ?? 0;
    if (available < quantity) {
      fail('insufficient_stock', `Only ${Math.max(available, 0)} of ${product.title} left.`, { fieldErrors: { [sku]: `Only ${Math.max(available, 0)} left.` } });
    }
    return {
      sku,
      productId: variant.productId,
      slug: product.slug,
      title: product.title,
      attributes: variant.attributes ?? {},
      image: product.images?.[0]?.src ?? null,
      unitPriceMinor: variant.retailPriceMinor,
      quantity,
      lineTotalMinor: variant.retailPriceMinor * quantity,
    };
  });

  const resolved = resolveFulfilment(fulfilment, settings);
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  return { lines, fulfilment: resolved, currency: settings.currency, subtotalMinor, deliveryFeeMinor: resolved.feeMinor, totalMinor: subtotalMinor + resolved.feeMinor };
}

// Unambiguous characters only, because customers read references out over the phone.
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newOrderReference = () => `STL-${[...randomBytes(8)].map(byte => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('')}`;
export const newAccessToken = () => randomBytes(24).toString('base64url');
export const hashAccessToken = token => sha256(`order-access\n${token}`);

/** Create the order and hold its stock. Caller runs this inside a transaction, after reads. */
export function createOrder(db, tx, { priced, contact, address, reservationMinutes, stockBySku }) {
  const reference = newOrderReference();
  const accessToken = newAccessToken();
  const createdAt = now();
  const order = {
    reference,
    accessTokenHash: hashAccessToken(accessToken),
    items: priced.lines,
    currency: priced.currency,
    subtotalMinor: priced.subtotalMinor,
    deliveryFeeMinor: priced.deliveryFeeMinor,
    totalMinor: priced.totalMinor,
    contact,
    fulfilment: { ...priced.fulfilment, address: address ?? null },
    paymentStatus: 'pending_payment',
    fulfilmentStatus: 'not_started',
    stockHeld: true,
    stockDeducted: false,
    reservationExpiresAt: new Date(Date.now() + reservationMinutes * 60_000).toISOString(),
    authorizationUrl: null,
    paidAt: null,
    attention: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    sortKey: sortKey(createdAt, reference),
  };
  for (const line of priced.lines) {
    tx.update(db.collection(C.skus).doc(line.sku), { reserved: stockBySku.get(line.sku).reserved + line.quantity, updatedAt: createdAt });
  }
  tx.create(db.collection(C.orders).doc(reference), order);
  recordAudit(db, tx, { actor: null, action: 'order.created', resourceType: 'order', resourceId: reference, after: { totalMinor: order.totalMinor, currency: order.currency, method: order.fulfilment.method } });
  return { order, accessToken };
}

/** Give held stock back. Reads SKU counters, so call before the transaction's other writes. */
async function releaseHold(db, tx, order) {
  const snaps = await readAll(db, order.items.map(line => db.collection(C.skus).doc(line.sku)), tx);
  return () => {
    snaps.forEach((snap, index) => {
      const reserved = Math.max(0, (snap.data()?.reserved ?? 0) - order.items[index].quantity);
      tx.update(snap.ref, { reserved, updatedAt: now() });
    });
  };
}

/** Expire one unpaid order if its hold has run out. Safe to call repeatedly. */
export function expireIfDue(db, reference) {
  return transaction(db, async tx => {
    const snap = await tx.get(db.collection(C.orders).doc(reference));
    const order = snap.data();
    if (!order || order.paymentStatus !== 'pending_payment' || order.reservationExpiresAt > now()) return false;
    const release = await releaseHold(db, tx, order);
    release();
    tx.update(snap.ref, { paymentStatus: 'payment_expired', stockHeld: false, version: order.version + 1, updatedAt: now() });
    recordAudit(db, tx, { actor: null, action: 'order.payment_expired', resourceType: 'order', resourceId: reference, before: { paymentStatus: order.paymentStatus }, after: { paymentStatus: 'payment_expired' } });
    return true;
  });
}

/** Sweep run on a schedule so abandoned orders do not keep stock off sale. */
export async function expireDueOrders(db, { limit = 100 } = {}) {
  const due = await db.collection(C.orders).where('paymentStatus', '==', 'pending_payment').where('reservationExpiresAt', '<=', now()).limit(limit).get();
  const results = await Promise.all(due.docs.map(doc => expireIfDue(db, doc.id)));
  return results.filter(Boolean).length;
}

/**
 * Record a payment the provider has verified. Idempotent: duplicate or out-of-order webhooks and verify calls
 * change nothing once the order is paid. Stock leaves the shelf here, with one ledger entry per line.
 */
export function applyVerifiedPayment(db, { reference, amountMinor, currency, providerId, paidAt, source }) {
  return transaction(db, async tx => {
    const orderRef = db.collection(C.orders).doc(reference);
    const snap = await tx.get(orderRef);
    const order = snap.data();
    if (!order) return { applied: false, reason: 'unknown_order' };
    if (order.paymentStatus === 'paid') return { applied: false, reason: 'already_paid' };

    const at = now();
    if (amountMinor !== order.totalMinor || currency !== order.currency) {
      // Never mark paid on a mismatch: a tampered or partial payment goes to staff instead.
      tx.update(orderRef, { attention: 'payment_mismatch', version: order.version + 1, updatedAt: at });
      recordAudit(db, tx, { actor: null, action: 'order.payment_mismatch', resourceType: 'order', resourceId: reference, metadata: { amountMinor, currency, expectedMinor: order.totalMinor, expectedCurrency: order.currency, source } });
      return { applied: false, reason: 'mismatch' };
    }

    const skuSnaps = await readAll(db, order.items.map(line => db.collection(C.skus).doc(line.sku)), tx);
    const counters = skuSnaps.map(s => stockOf(s.data()));
    // A payment can arrive after its hold expired. Take stock only if it is still free; otherwise staff must resolve it.
    const canDeduct = order.stockHeld || order.items.every((line, i) => counters[i].available >= line.quantity);
    if (canDeduct) {
      order.items.forEach((line, i) => {
        const { onHand, reserved } = counters[i];
        const nextOnHand = onHand - line.quantity;
        tx.update(skuSnaps[i].ref, { onHand: nextOnHand, reserved: order.stockHeld ? Math.max(0, reserved - line.quantity) : reserved, updatedAt: at });
        const id = newId('mov');
        tx.create(db.collection(C.inventoryMovements).doc(id), {
          sku: line.sku, quantity: -line.quantity, reason: 'retail_sale', sourceType: 'order', sourceKey: `order:${reference}:${line.sku}`,
          note: reference, actorId: null, stockAfter: nextOnHand, createdAt: at, sortKey: sortKey(at, id),
        });
      });
    }
    tx.set(db.collection(C.payments).doc(reference), { reference, provider: 'paystack', providerId, amountMinor, currency, paidAt: paidAt ?? at, source, recordedAt: at });
    tx.update(orderRef, {
      paymentStatus: 'paid', paidAt: paidAt ?? at, stockHeld: false, stockDeducted: canDeduct,
      attention: canDeduct ? null : 'paid_without_stock', version: order.version + 1, updatedAt: at,
    });
    recordAudit(db, tx, { actor: null, action: 'order.paid', resourceType: 'order', resourceId: reference, before: { paymentStatus: order.paymentStatus }, after: { paymentStatus: 'paid' }, metadata: { amountMinor, currency, providerId, source, stockDeducted: canDeduct } });
    return { applied: true };
  });
}

/** Staff cancel an unpaid order. A paid order needs a refund first, which is not built yet. */
export function cancelUnpaidOrder(db, { reference, staff, requestId, expectedVersion, reason }) {
  return transaction(db, async tx => {
    const snap = await tx.get(db.collection(C.orders).doc(reference));
    const order = snap.data();
    if (!order) fail('not_found', 'Order not found.');
    if (order.version !== expectedVersion) fail('stale_version', 'This order was changed by someone else. Reload to see the latest version.');
    if (order.paymentStatus === 'paid') fail('refund_required', 'This order is paid. Refund it in Paystack before cancelling.');
    if (order.fulfilmentStatus === 'cancelled') fail('invalid_transition', 'This order is already cancelled.');
    const release = order.stockHeld ? await releaseHold(db, tx, order) : () => {};
    release();
    tx.update(snap.ref, { fulfilmentStatus: 'cancelled', stockHeld: false, version: order.version + 1, updatedAt: now() });
    recordAudit(db, tx, { actor: staff, requestId, action: 'order.cancelled', resourceType: 'order', resourceId: reference, before: { fulfilmentStatus: order.fulfilmentStatus }, after: { fulfilmentStatus: 'cancelled' }, metadata: { reason } });
  });
}
