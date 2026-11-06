// Customer checkout: options, quote, order, payment. Guests need no account; holding an order's private token
// (returned once, when the order is created) is what lets a browser read it or pay for it.
import { RateLimiter, safeEqual } from '../auth.js';
import { stockLevels } from '../catalogue.js';
import { applyInstalmentPayment, isInstalmentReference } from '../agreements.js';
import { C, read, transaction } from '../firestore.js';
import { fail, readRaw } from '../http.js';
import { idempotent } from '../idempotency.js';
import {
  applyVerifiedPayment, checkoutReadiness, createOrder, expireIfDue, hashAccessToken, loadCheckoutSettings, priceBasket,
} from '../orders.js';
import { EMAIL, SKU, arrayOf, int, shape, str, validate } from '../validate.js';

const itemsRule = arrayOf(shape({ sku: str({ max: 40, pattern: SKU, patternMessage: 'Invalid SKU.' }), quantity: int({ min: 1, max: 20 }) }), { max: 20 });

// A delivery needs a zone; collection needs nothing else. Anything else is rejected.
export const fulfilmentRule = input => {
  if (input?.method === 'pickup' && Object.keys(input).length === 1) return { value: { method: 'pickup' } };
  if (input?.method === 'delivery' && typeof input.zoneId === 'string' && Object.keys(input).length === 2) return { value: { method: 'delivery', zoneId: input.zoneId } };
  return { error: 'Choose delivery to an area, or in-store collection.' };
};

const contactRule = shape({
  name: str({ min: 2, max: 120 }),
  phone: str({ max: 20, pattern: /^\+?[0-9][0-9 -]{7,18}$/, patternMessage: 'Enter a valid phone number.' }),
  email: str({ max: 200, pattern: EMAIL, patternMessage: 'Enter a valid email address.' }),
});

export const addressRule = shape({
  digitalAddress: str({ max: 20, pattern: /^[A-Za-z]{2}-?\d{3,4}-?\d{3,4}$/, patternMessage: 'Use a GhanaPostGPS address such as GA-183-8164.' }),
  area: str({ max: 120 }),
  landmark: str({ min: 0, max: 200 }),
});

function requireItems(items) {
  if (!items.length) fail('validation_failed', 'Your bag is empty.', { fieldErrors: { items: 'Add at least one item.' } });
}

export const publicOrderDto = order => ({
  reference: order.reference,
  items: order.items,
  currency: order.currency,
  subtotalMinor: order.subtotalMinor,
  deliveryFeeMinor: order.deliveryFeeMinor,
  totalMinor: order.totalMinor,
  contact: order.contact,
  fulfilment: order.fulfilment,
  paymentStatus: order.paymentStatus,
  fulfilmentStatus: order.fulfilmentStatus,
  reservationExpiresAt: order.reservationExpiresAt,
  paidAt: order.paidAt,
  createdAt: order.createdAt,
});

const quoteDto = priced => ({
  items: priced.lines.map(({ sku, title, slug, attributes, unitPriceMinor, quantity, lineTotalMinor }) => ({ sku, title, slug, attributes, unitPriceMinor, quantity, lineTotalMinor })),
  currency: priced.currency,
  subtotalMinor: priced.subtotalMinor,
  deliveryFeeMinor: priced.deliveryFeeMinor,
  totalMinor: priced.totalMinor,
});

/** Load an order for whoever holds its token. A wrong token looks exactly like a missing order. */
async function loadOwnedOrder(ctx, { expire = true } = {}) {
  const reference = ctx.params.reference;
  const token = ctx.req.headers['x-order-token'];
  const ref = ctx.db.collection(C.orders).doc(reference);
  let order = (await ref.get()).data();
  if (!order || typeof token !== 'string' || !safeEqual(hashAccessToken(token), order.accessTokenHash)) fail('not_found', 'Order not found.');
  if (expire && order.paymentStatus === 'pending_payment' && order.reservationExpiresAt <= new Date().toISOString()) {
    await expireIfDue(ctx.db, reference);
    order = (await ref.get()).data();
  }
  return { ref, order };
}

/** Only ever return customers to our own site after payment. */
export function returnOrigin(ctx) {
  const origin = ctx.req.headers.origin;
  const allowed = ctx.config.allowedOrigins.includes(origin) || (ctx.config.allowLoopbackOrigins && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? ''));
  return allowed ? origin : ctx.config.allowedOrigins[0];
}

export function registerCheckout(route, db, payments, config) {
  const quoteLimiter = new RateLimiter(db, { name: 'checkout-quote', limit: 120, windowMs: 15 * 60_000 });
  // Every order holds stock for a while, so one visitor must not be able to empty the shelves.
  const orderLimiter = new RateLimiter(db, { name: 'checkout-order', limit: config.orderRateLimit, windowMs: 60 * 60_000 });

  route('GET', '/checkout/options', async ctx => {
    const settings = await loadCheckoutSettings(ctx.db);
    const { canQuote, canOrder, missing } = checkoutReadiness(settings, payments);
    return {
      data: {
        canQuote, canOrder, missing,
        currency: settings.currency,
        deliveryZones: settings.deliveryZones,
        pickup: settings.pickup,
        reservationMinutes: settings.reservationMinutes,
        returnsPolicy: settings.returnsPolicy,
      },
    };
  });

  route('POST', '/checkout/quote', async ctx => {
    const settings = await loadCheckoutSettings(ctx.db);
    if (!checkoutReadiness(settings, payments).canQuote) fail('not_configured', 'Checkout is not open yet.');
    await quoteLimiter.check(ctx.ip);
    const input = validate(ctx.body, { items: itemsRule, fulfilment: fulfilmentRule });
    requireItems(input.items);
    const priced = await priceBasket(ctx.db, input, settings);
    await quoteLimiter.record(ctx.ip);
    return { data: quoteDto(priced) };
  });

  route('POST', '/orders', async ctx => {
    const opening = await loadCheckoutSettings(ctx.db);
    if (!checkoutReadiness(opening, payments).canOrder) fail('not_configured', 'Checkout is not open yet.');
    await orderLimiter.check(ctx.ip);
    const input = validate(ctx.body, {
      items: itemsRule, fulfilment: fulfilmentRule, contact: contactRule, address: addressRule,
      expectedTotalMinor: int({ min: 0 }),
    }, { optional: ['address'] });
    requireItems(input.items);
    if (input.fulfilment.method === 'delivery' && !input.address) {
      fail('validation_failed', 'Some details need attention.', { fieldErrors: { address: 'Enter your delivery address.' } });
    }

    const result = await idempotent(ctx, 'order.create', async tx => {
      const settings = await loadCheckoutSettings(ctx.db, tx);
      const priced = await priceBasket(ctx.db, input, settings, tx);
      // The customer agreed to a specific total. If it moved since their quote, they must see the new one first.
      if (priced.totalMinor !== input.expectedTotalMinor) fail('price_changed', 'The total has changed. Please review your order again.');
      const stockBySku = await stockLevels(ctx.db, priced.lines.map(line => line.sku), tx);
      const { order, accessToken } = createOrder(ctx.db, tx, {
        priced, contact: input.contact, address: input.fulfilment.method === 'delivery' ? input.address : null,
        reservationMinutes: settings.reservationMinutes, stockBySku,
      });
      return { status: 201, data: { order: publicOrderDto(order), accessToken } };
    });
    if (!result.headers?.['Idempotent-Replayed']) await orderLimiter.record(ctx.ip);
    return result;
  });

  route('GET', '/orders/:reference', async ctx => {
    const { order } = await loadOwnedOrder(ctx);
    return { data: publicOrderDto(order) };
  });

  route('POST', '/orders/:reference/payments', async ctx => {
    if (!payments.configured) fail('not_configured', 'Online payment is not available yet.');
    const { ref, order } = await loadOwnedOrder(ctx);
    if (order.paymentStatus === 'paid') fail('invalid_transition', 'This order is already paid.');
    if (order.paymentStatus !== 'pending_payment' || order.fulfilmentStatus === 'cancelled') fail('order_expired', 'This order has expired. Please start checkout again.');
    // One Paystack transaction per order: the same reference cannot be paid twice, and retries reuse the same page.
    if (order.authorizationUrl) return { data: { authorizationUrl: order.authorizationUrl } };
    const { authorizationUrl } = await payments.initialize({
      email: order.contact.email, amountMinor: order.totalMinor, currency: order.currency, reference: order.reference,
      callbackUrl: `${returnOrigin(ctx)}/order/${order.reference}`,
    });
    await ref.update({ authorizationUrl, updatedAt: new Date().toISOString() });
    return { data: { authorizationUrl } };
  });

  // The return from Paystack proves nothing by itself, so the server asks Paystack what happened.
  route('POST', '/orders/:reference/payments/verify', async ctx => {
    const { ref, order } = await loadOwnedOrder(ctx, { expire: false });
    if (payments.configured && order.paymentStatus !== 'paid' && order.authorizationUrl) {
      const verified = await payments.verify(order.reference);
      if (verified.success) await applyVerifiedPayment(ctx.db, { reference: order.reference, ...verified, source: 'verify' });
    }
    return { data: publicOrderDto((await ref.get()).data()) };
  });

  route('POST', '/webhooks/paystack', async ctx => {
    const raw = await readRaw(ctx.req);
    if (!payments.configured || !payments.verifySignature(raw, ctx.req.headers['x-paystack-signature'])) fail('invalid_signature', 'Invalid signature.');
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { fail('invalid_json', 'The request body is not valid JSON.'); }
    if (event.event === 'charge.success' && event.data?.status === 'success' && typeof event.data.reference === 'string') {
      const apply = isInstalmentReference(event.data.reference) ? applyInstalmentPayment : applyVerifiedPayment;
      await apply(ctx.db, {
        reference: event.data.reference, amountMinor: event.data.amount, currency: event.data.currency,
        providerId: String(event.data.id), paidAt: event.data.paid_at ?? null, source: 'webhook',
      });
    }
    // Always acknowledge signed events, even ones we ignore, or Paystack keeps retrying them.
    return { data: { received: true } };
  }, { skipBody: true });
}
