import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { client, createCategory, createProduct, ownerClient, startTestServer, staffClient } from './helpers.js';
import { expireDueOrders } from '../src/orders.js';
import { paystackProvider } from '../src/paystack.js';

const SECRET = 'sk_test_fixture';
const CONTACT = { name: 'Ama Mensah', phone: '+233 24 123 4567', email: 'ama@example.test' };
const ADDRESS = { digitalAddress: 'GA-183-8164', area: 'Osu', landmark: 'Near the castle' };
const PRICE = 150_00;
const FEE = 20_00;

/** Real signature check and a scripted Paystack, so nothing leaves the machine. */
function fakePayments() {
  const real = paystackProvider({ secretKey: SECRET });
  const fake = {
    configured: true,
    initialized: [],
    verifyResult: null,
    verifySignature: real.verifySignature,
    async initialize(args) { fake.initialized.push(args); return { authorizationUrl: `https://checkout.paystack.test/${args.reference}` }; },
    async verify() { return fake.verifyResult ?? { success: false }; },
  };
  return fake;
}

let keyCounter = 0;
const idempotencyKey = () => `order-key-${++keyCounter}-${Date.now()}`;

describe('retail checkout', () => {
  let server;
  let owner;
  let shopper;
  let payments;
  const SKU = 'TV-43';
  const delivery = { method: 'delivery', zoneId: 'accra' };

  const setting = (key, value) => owner.put(`/admin/settings/${key}`, { value, expectedVersion: 0 });
  const stock = async sku => (await owner.get(`/admin/inventory?q=${sku}`)).body.data.items[0];
  const placeOrder = (overrides = {}, key = idempotencyKey()) => shopper.post('/orders', {
    items: [{ sku: SKU, quantity: 1 }], fulfilment: delivery, contact: CONTACT, address: ADDRESS, expectedTotalMinor: PRICE + FEE, ...overrides,
  }, { headers: { 'Idempotency-Key': key } });
  const asCustomer = (order, token) => ({ 'X-Order-Token': token ?? order.accessToken });
  const webhook = (payload, signature) => {
    const raw = JSON.stringify(payload);
    return fetch(`${server.base}/webhooks/paystack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Paystack-Signature': signature ?? createHmac('sha512', SECRET).update(raw).digest('hex') },
      body: raw,
    });
  };
  const chargeSuccess = (reference, overrides = {}) => ({ event: 'charge.success', data: { id: 987, status: 'success', reference, amount: PRICE + FEE, currency: 'GHS', paid_at: '2026-11-05T12:00:00.000Z', ...overrides } });

  before(async () => {
    payments = fakePayments();
    server = await startTestServer({ payments });
    owner = await ownerClient(server.base);
    shopper = client(server.base);
    await setting('store.currency', 'GHS');
    const category = await createCategory(owner, { slug: 'tv', label: 'TV' });
    const product = await createProduct(owner, category.id, { slug: 'tv-43', title: 'Television 43' });
    await owner.post(`/admin/products/${product.id}/variants`, { sku: SKU, retailPriceMinor: PRICE, currency: 'GHS' });
    const fresh = (await owner.get(`/admin/products/${product.id}`)).body.data;
    assert.equal((await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: fresh.version })).status, 200);
    await owner.post('/admin/inventory/movements', { sku: SKU, quantity: 30, reason: 'stock_received' }, { headers: { 'Idempotency-Key': idempotencyKey() } });
  });
  after(() => server.close());

  test('checkout stays closed until the owner has set delivery, hold time and returns wording', async () => {
    const options = (await shopper.get('/checkout/options')).body.data;
    assert.equal(options.canOrder, false);
    assert.ok(options.missing.includes('checkout.deliveryZones'));
    assert.equal((await shopper.post('/checkout/quote', { items: [{ sku: SKU, quantity: 1 }], fulfilment: { method: 'pickup' } })).status, 503);
    assert.equal((await placeOrder()).status, 503);

    await setting('checkout.deliveryZones', [{ id: 'accra', name: 'Accra', feeMinor: FEE }]);
    await setting('checkout.pickup', { address: 'Store address', hours: 'Mon to Sat' });
    await setting('checkout.reservationMinutes', 30);
    await setting('checkout.returnsPolicy', 'Returns wording from the owner.');
    const ready = (await shopper.get('/checkout/options')).body.data;
    assert.equal(ready.canOrder, true);
    assert.deepEqual(ready.missing, []);
  });

  test('checkout refuses orders when no payment provider is configured', async () => {
    const closed = await startTestServer();
    const closedOwner = await ownerClient(closed.base);
    await closedOwner.put('/admin/settings/store.currency', { value: 'GHS', expectedVersion: 0 });
    await closedOwner.put('/admin/settings/checkout.pickup', { value: { address: 'A', hours: 'B' }, expectedVersion: 0 });
    await closedOwner.put('/admin/settings/checkout.reservationMinutes', { value: 30, expectedVersion: 0 });
    await closedOwner.put('/admin/settings/checkout.returnsPolicy', { value: 'R', expectedVersion: 0 });
    const options = (await closedOwner.get('/checkout/options')).body.data;
    assert.deepEqual(options.missing, ['payment_provider']);
    assert.equal(options.canQuote, true);
    assert.equal(options.canOrder, false);
    await closed.close();
  });

  test('the server sets every price; extra fields from the browser are rejected', async () => {
    const quote = await shopper.post('/checkout/quote', { items: [{ sku: SKU, quantity: 2 }], fulfilment: delivery });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.data.subtotalMinor, PRICE * 2);
    assert.equal(quote.body.data.deliveryFeeMinor, FEE);
    assert.equal(quote.body.data.totalMinor, PRICE * 2 + FEE);
    const pickup = await shopper.post('/checkout/quote', { items: [{ sku: SKU, quantity: 1 }], fulfilment: { method: 'pickup' } });
    assert.equal(pickup.body.data.deliveryFeeMinor, 0);
    const tampered = await shopper.post('/checkout/quote', { items: [{ sku: SKU, quantity: 1, unitPriceMinor: 1 }], fulfilment: delivery });
    assert.equal(tampered.status, 422);
    const badZone = await shopper.post('/checkout/quote', { items: [{ sku: SKU, quantity: 1 }], fulfilment: { method: 'delivery', zoneId: 'moon' } });
    assert.equal(badZone.status, 422);
    const unknown = await shopper.post('/checkout/quote', { items: [{ sku: 'NOPE-1', quantity: 1 }], fulfilment: delivery });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.error.code, 'item_unavailable');
  });

  test('an order needs the total the customer agreed to, and an address for delivery', async () => {
    const stale = await placeOrder({ expectedTotalMinor: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'price_changed');
    const { address, ...noAddress } = { items: [{ sku: SKU, quantity: 1 }], fulfilment: delivery, contact: CONTACT, address: ADDRESS, expectedTotalMinor: PRICE + FEE };
    assert.ok(address);
    const missing = await shopper.post('/orders', noAddress, { headers: { 'Idempotency-Key': idempotencyKey() } });
    assert.equal(missing.status, 422);
    assert.ok(missing.body.error.fieldErrors.address);
  });

  test('placing an order holds stock, and a replay does not hold it twice', async () => {
    const before = await stock(SKU);
    const key = idempotencyKey();
    const first = await placeOrder({}, key);
    assert.equal(first.status, 201);
    const replay = await placeOrder({}, key);
    assert.equal(replay.body.data.order.reference, first.body.data.order.reference);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    const after = await stock(SKU);
    assert.equal(after.reserved, before.reserved + 1);
    assert.equal(after.onHand, before.onHand);
    assert.equal(first.body.data.order.paymentStatus, 'pending_payment');
    assert.equal(JSON.stringify(first.body.data.order).includes('accessTokenHash'), false);
  });

  test('only the holder of the order token can read or pay for an order', async () => {
    const { order, accessToken } = (await placeOrder()).body.data;
    const anon = await shopper.get(`/orders/${order.reference}`);
    assert.equal(anon.status, 404);
    const wrong = await shopper.get(`/orders/${order.reference}`, { headers: asCustomer(null, 'wrong-token') });
    assert.equal(wrong.status, 404);
    const mine = await shopper.get(`/orders/${order.reference}`, { headers: asCustomer(null, accessToken) });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.reference, order.reference);
    assert.equal((await shopper.post(`/orders/${order.reference}/payments`, {}, { headers: asCustomer(null, 'wrong-token') })).status, 404);
  });

  test('starting payment sends the server total to Paystack and reuses the same payment page', async () => {
    const { order, accessToken } = (await placeOrder()).body.data;
    const headers = asCustomer(null, accessToken);
    const first = await shopper.post(`/orders/${order.reference}/payments`, {}, { headers });
    assert.equal(first.status, 200);
    assert.match(first.body.data.authorizationUrl, /checkout\.paystack\.test/);
    const call = payments.initialized.at(-1);
    assert.equal(call.amountMinor, PRICE + FEE);
    assert.equal(call.currency, 'GHS');
    assert.equal(call.reference, order.reference);
    assert.match(call.callbackUrl, new RegExp(`/order/${order.reference}$`));
    const count = payments.initialized.length;
    const again = await shopper.post(`/orders/${order.reference}/payments`, {}, { headers });
    assert.equal(again.body.data.authorizationUrl, first.body.data.authorizationUrl);
    assert.equal(payments.initialized.length, count);
  });

  test('a forged webhook is rejected and changes nothing', async () => {
    const { order, accessToken } = (await placeOrder()).body.data;
    const response = await webhook(chargeSuccess(order.reference), 'forged-signature');
    assert.equal(response.status, 401);
    const read = await shopper.get(`/orders/${order.reference}`, { headers: asCustomer(null, accessToken) });
    assert.equal(read.body.data.paymentStatus, 'pending_payment');
  });

  test('a signed webhook marks the order paid and moves stock exactly once', async () => {
    const before = await stock(SKU);
    const { order, accessToken } = (await placeOrder()).body.data;
    const held = await stock(SKU);
    assert.equal(held.reserved, before.reserved + 1);
    assert.equal((await webhook(chargeSuccess(order.reference))).status, 200);
    assert.equal((await webhook(chargeSuccess(order.reference))).status, 200);
    const read = await shopper.get(`/orders/${order.reference}`, { headers: asCustomer(null, accessToken) });
    assert.equal(read.body.data.paymentStatus, 'paid');
    const after = await stock(SKU);
    assert.equal(after.onHand, before.onHand - 1);
    assert.equal(after.reserved, before.reserved);
    const movements = (await owner.get(`/admin/inventory/movements?sku=${SKU}`)).body.data.items.filter(m => m.reason === 'retail_sale' && m.note === order.reference);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].quantity, -1);
  });

  test('a payment for the wrong amount or currency is never treated as paid', async () => {
    const { order, accessToken } = (await placeOrder()).body.data;
    await webhook(chargeSuccess(order.reference, { amount: 1 }));
    await webhook(chargeSuccess(order.reference, { currency: 'USD' }));
    const read = await shopper.get(`/orders/${order.reference}`, { headers: asCustomer(null, accessToken) });
    assert.equal(read.body.data.paymentStatus, 'pending_payment');
    const admin = await owner.get(`/admin/orders/${order.reference}`);
    assert.equal(admin.body.data.attention, 'payment_mismatch');
  });

  test('returning from Paystack confirms payment only when Paystack itself says so', async () => {
    const { order, accessToken } = (await placeOrder()).body.data;
    const headers = asCustomer(null, accessToken);
    await shopper.post(`/orders/${order.reference}/payments`, {}, { headers });
    payments.verifyResult = { success: false };
    assert.equal((await shopper.post(`/orders/${order.reference}/payments/verify`, {}, { headers })).body.data.paymentStatus, 'pending_payment');
    payments.verifyResult = { success: true, amountMinor: PRICE + FEE, currency: 'GHS', providerId: '555', paidAt: null };
    assert.equal((await shopper.post(`/orders/${order.reference}/payments/verify`, {}, { headers })).body.data.paymentStatus, 'paid');
    payments.verifyResult = null;
  });

  test('unpaid orders expire and give their stock back', async () => {
    const before = await stock(SKU);
    const { order, accessToken } = (await placeOrder()).body.data;
    await server.db.collection('orders').doc(order.reference).update({ reservationExpiresAt: '2020-01-01T00:00:00.000Z' });
    assert.ok(await expireDueOrders(server.db) >= 1);
    const after = await stock(SKU);
    assert.equal(after.reserved, before.reserved);
    const headers = asCustomer(null, accessToken);
    assert.equal((await shopper.get(`/orders/${order.reference}`, { headers })).body.data.paymentStatus, 'payment_expired');
    const pay = await shopper.post(`/orders/${order.reference}/payments`, {}, { headers });
    assert.equal(pay.status, 409);
    assert.equal(pay.body.error.code, 'order_expired');
  });

  test('a payment arriving after expiry still counts, and takes stock if it is free', async () => {
    const before = await stock(SKU);
    const { order } = (await placeOrder()).body.data;
    await server.db.collection('orders').doc(order.reference).update({ reservationExpiresAt: '2020-01-01T00:00:00.000Z' });
    await expireDueOrders(server.db);
    assert.equal((await webhook(chargeSuccess(order.reference))).status, 200);
    const admin = (await owner.get(`/admin/orders/${order.reference}`)).body.data;
    assert.equal(admin.paymentStatus, 'paid');
    assert.equal(admin.stockDeducted, true);
    assert.equal(admin.attention, null);
    assert.equal((await stock(SKU)).onHand, before.onHand - 1);
  });

  test('concurrent orders for the last units: never more than the stock', async () => {
    const category = await createCategory(owner, { slug: 'radio', label: 'Radio' });
    const product = await createProduct(owner, category.id, { slug: 'radio-1', title: 'Radio' });
    await owner.post(`/admin/products/${product.id}/variants`, { sku: 'RADIO-1', retailPriceMinor: PRICE, currency: 'GHS' });
    const fresh = (await owner.get(`/admin/products/${product.id}`)).body.data;
    await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: fresh.version });
    await owner.post('/admin/inventory/movements', { sku: 'RADIO-1', quantity: 2, reason: 'stock_received' }, { headers: { 'Idempotency-Key': idempotencyKey() } });
    const results = await Promise.all(Array.from({ length: 5 }, () => placeOrder({ items: [{ sku: 'RADIO-1', quantity: 1 }] })));
    assert.equal(results.filter(r => r.status === 201).length, 2);
    assert.ok(results.filter(r => r.status !== 201).every(r => r.body.error.code === 'insufficient_stock'));
    const after = await stock('RADIO-1');
    assert.equal(after.available, 0);
    assert.equal(after.reserved, 2);
  });

  test('one visitor cannot hold stock with endless orders', async () => {
    const limited = await startTestServer({ payments: fakePayments(), config: { orderRateLimit: 1 } });
    const limitedOwner = await ownerClient(limited.base);
    const put = (key, value) => limitedOwner.put(`/admin/settings/${key}`, { value, expectedVersion: 0 });
    await put('store.currency', 'GHS');
    await put('checkout.pickup', { address: 'A', hours: 'B' });
    await put('checkout.reservationMinutes', 30);
    await put('checkout.returnsPolicy', 'R');
    const category = await createCategory(limitedOwner, { slug: 'tv', label: 'TV' });
    const product = await createProduct(limitedOwner, category.id, { slug: 'tv-1', title: 'TV' });
    await limitedOwner.post(`/admin/products/${product.id}/variants`, { sku: 'TV-1', retailPriceMinor: PRICE, currency: 'GHS' });
    const fresh = (await limitedOwner.get(`/admin/products/${product.id}`)).body.data;
    await limitedOwner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: fresh.version });
    await limitedOwner.post('/admin/inventory/movements', { sku: 'TV-1', quantity: 5, reason: 'stock_received' }, { headers: { 'Idempotency-Key': idempotencyKey() } });
    const buyer = client(limited.base);
    const order = () => buyer.post('/orders', { items: [{ sku: 'TV-1', quantity: 1 }], fulfilment: { method: 'pickup' }, contact: CONTACT, expectedTotalMinor: PRICE }, { headers: { 'Idempotency-Key': idempotencyKey() } });
    assert.equal((await order()).status, 201);
    assert.equal((await order()).status, 429);
    await limited.close();
  });

  test('staff fulfil paid orders in order, and customer details stay behind permissions', async () => {
    const list = (await owner.get('/admin/orders?paymentStatus=paid')).body.data.items;
    assert.ok(list.length > 0);
    let order = list[0];
    const skip = await owner.post(`/admin/orders/${order.reference}/fulfilment`, { action: 'deliver', expectedVersion: order.version });
    assert.equal(skip.status, 409);
    for (const action of ['start_processing', 'dispatch', 'deliver']) {
      const moved = await owner.post(`/admin/orders/${order.reference}/fulfilment`, { action, expectedVersion: order.version });
      assert.equal(moved.status, 200, action);
      order = moved.body.data;
    }
    assert.equal(order.fulfilmentStatus, 'delivered');
    const cancelPaid = await owner.post(`/admin/orders/${order.reference}/cancel`, { expectedVersion: order.version, reason: 'Changed mind' });
    assert.equal(cancelPaid.body.error.code, 'refund_required');

    const pending = (await owner.get('/admin/orders?paymentStatus=pending_payment')).body.data.items[0];
    assert.equal((await owner.post(`/admin/orders/${pending.reference}/fulfilment`, { action: 'start_processing', expectedVersion: pending.version })).status, 409);

    const { client: manager } = await staffClient(server.base, owner, { email: 'cm-orders@example.test', roles: ['catalogue_manager'] });
    assert.equal((await manager.get('/admin/orders')).status, 403);
    const { client: fulfilment } = await staffClient(server.base, owner, { email: 'ff-orders@example.test', roles: ['fulfilment'] });
    assert.equal((await fulfilment.get('/admin/orders')).status, 200);
    assert.equal((await client(server.base).get('/admin/orders')).status, 401);
  });

  test('cancelling an unpaid order releases its stock', async () => {
    const pending = (await owner.get('/admin/orders?paymentStatus=pending_payment')).body.data.items[0];
    const sku = pending.items[0].sku;
    const before = await stock(sku);
    const cancelled = await owner.post(`/admin/orders/${pending.reference}/cancel`, { expectedVersion: pending.version, reason: 'Customer called to cancel' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.fulfilmentStatus, 'cancelled');
    assert.equal((await stock(sku)).reserved, before.reserved - pending.items[0].quantity);
  });

  test('audit records never contain customer contact details or order tokens', async () => {
    const events = await server.db.collection('auditEvents').where('resourceType', '==', 'order').get();
    assert.ok(events.size > 3);
    const text = JSON.stringify(events.docs.map(doc => doc.data()));
    assert.doesNotMatch(text, /ama@example\.test|123 4567|accessToken/);
  });
});

describe('Paystack signature check', () => {
  test('accepts only the exact bytes signed with the secret key', () => {
    const provider = paystackProvider({ secretKey: SECRET });
    const raw = Buffer.from('{"event":"charge.success"}');
    const good = createHmac('sha512', SECRET).update(raw).digest('hex');
    assert.equal(provider.verifySignature(raw, good), true);
    assert.equal(provider.verifySignature(Buffer.from('{"event":"charge.failed"}'), good), false);
    assert.equal(provider.verifySignature(raw, createHmac('sha512', 'other').update(raw).digest('hex')), false);
    assert.equal(provider.verifySignature(raw, undefined), false);
    assert.equal(paystackProvider({ secretKey: null }).verifySignature(raw, good), false);
  });
});
