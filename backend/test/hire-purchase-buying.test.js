import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { addMonths } from '../src/agreements.js';
import { expireDueOrders } from '../src/orders.js';
import { paystackProvider } from '../src/paystack.js';
import { C } from '../src/firestore.js';
import { createCategory, createProduct, ownerClient, staffClient, startTestServer } from './helpers.js';

const SECRET = 'sk_test_fixture';
const SKU = 'FRIDGE-1';
const PLAIN_SKU = 'PLAIN-1';
const PRICE = 1000_00;
const PLAN = { id: 'six', name: 'Three months', depositBasisPoints: 2000, instalments: 3, chargeBasisPoints: 1000 };
const DUE_NOW = 200_00;
const HP_PRICE = 1080_00;
const FINANCED = 880_00;

let server;
let owner;
let payments;
let keys = 0;
const key = () => `hp-key-${++keys}-${Date.now()}`;
const customerAuth = { async verifyIdToken(token) { const [uid, email] = token.split(':'); return { uid, email, email_verified: true }; } };

function customer(uid) {
  return async (method, path, body, headers = {}) => {
    const response = await fetch(`${server.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${uid}:${uid}@example.test`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

async function approve(uid, limitMinor = 5000_00, validUntil = '2999-01-01') {
  await server.db.collection(C.hpApplications).doc(uid).set({
    uid, email: `${uid}@example.test`, status: 'approved', version: 1, submittedAt: new Date().toISOString(),
    sections: { identity: { fullName: `Name ${uid}` }, contact: { phone: '024 123 4567' }, residence: { digitalAddress: 'GA-183-8164', area: 'Osu', landmark: null } },
    decision: { outcome: 'approve', limitMinor, currency: 'GHS', validUntil, conditions: null, decidedAt: new Date().toISOString() },
  });
  return customer(uid);
}

const setSetting = async (name, value) => {
  const { version } = (await owner.get('/admin/settings')).body.data.find(setting => setting.key === name);
  const result = await owner.put(`/admin/settings/${name}`, { value, expectedVersion: version });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.data.version;
};

let termsVersion;
const accept = (person, overrides = {}, idempotencyKey = key()) => person('POST', '/me/hire-purchase/agreements', {
  sku: SKU, planId: PLAN.id, fulfilment: { method: 'pickup' }, accepted: true, termsVersion, expectedDueNowMinor: DUE_NOW, expectedHirePurchasePriceMinor: HP_PRICE, ...overrides,
}, { 'Idempotency-Key': idempotencyKey });

const webhook = (reference, amount, currency = 'GHS') => {
  const raw = JSON.stringify({ event: 'charge.success', data: { id: 55, status: 'success', reference, amount, currency, paid_at: new Date().toISOString() } });
  return fetch(`${server.base}/webhooks/paystack`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Paystack-Signature': createHmac('sha512', SECRET).update(raw).digest('hex') }, body: raw });
};

const stock = async sku => (await owner.get(`/admin/inventory?q=${sku}`)).body.data.items[0];

async function activeAgreement(person) {
  const created = await accept(person);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await webhook(created.body.data.orderReference, DUE_NOW);
  return (await person('GET', `/me/hire-purchase/agreements/${created.body.data.id}`)).body.data;
}

before(async () => {
  const real = paystackProvider({ secretKey: SECRET });
  payments = {
    configured: true,
    verifySignature: real.verifySignature,
    initialized: [],
    verifyResult: { success: false },
    async initialize(args) { payments.initialized.push(args); return { authorizationUrl: `https://checkout.paystack.test/${args.reference}` }; },
    async verify() { return payments.verifyResult; },
  };
  server = await startTestServer({ payments, customerAuth });
  owner = await ownerClient(server.base);
  await setSetting('store.currency', 'GHS');
  await setSetting('checkout.pickup', { address: 'Accra Mall', hours: '9 to 5' });
  await setSetting('checkout.reservationMinutes', 30);
  const category = await createCategory(owner, { slug: 'home', label: 'Home' });
  for (const [slug, sku, eligible] of [['fridge', SKU, true], ['plain', PLAIN_SKU, false]]) {
    const product = await createProduct(owner, category.id, { slug, title: slug });
    const variant = await owner.post(`/admin/products/${product.id}/variants`, { sku, retailPriceMinor: PRICE, currency: 'GHS' });
    assert.equal(variant.status, 201, JSON.stringify(variant.body));
    assert.equal((await owner.post('/admin/inventory/movements', { sku, quantity: 20, reason: 'stock_received' }, { headers: { 'Idempotency-Key': key() } })).status, 201);
    const fresh = (await owner.get(`/admin/products/${product.id}`)).body.data;
    const published = await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: fresh.version });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    if (eligible) {
      const latest = (await owner.get(`/admin/products/${product.id}`)).body.data;
      const enabled = await owner.post(`/admin/products/${product.id}/hire-purchase`, { enabled: true, reason: 'Eligible', expectedVersion: latest.version });
      assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    }
  }
});
after(() => server.close());

test('buying is for current approvals only, and stays closed until plans and terms are set', async () => {
  const stranger = customer('stranger');
  assert.equal((await stranger('GET', '/me/hire-purchase/buying')).body.error.code, 'not_approved');
  assert.equal((await stranger('POST', '/me/hire-purchase/quote', { sku: SKU, planId: 'x', fulfilment: { method: 'pickup' } })).status, 403);
  assert.equal((await stranger('POST', '/me/hire-purchase/agreements', { sku: SKU, planId: 'x', fulfilment: { method: 'pickup' }, accepted: true, termsVersion: 1, expectedDueNowMinor: 1, expectedHirePurchasePriceMinor: 1 }, { 'Idempotency-Key': key() })).body.error.code, 'not_approved');
  const lapsed = await approve('lapsed', 5000_00, '2020-01-01');
  assert.equal((await lapsed('GET', '/me/hire-purchase/buying')).status, 403);

  const person = await approve('early');
  const closed = (await person('GET', '/me/hire-purchase/buying')).body.data;
  assert.equal(closed.open, false);
  assert.equal(closed.plans, undefined);
  assert.equal((await person('POST', '/me/hire-purchase/quote', { sku: SKU, planId: PLAN.id, fulfilment: { method: 'pickup' } })).status, 503);

  assert.equal((await owner.put('/admin/settings/hirePurchase.plans', { value: [{ ...PLAN, depositBasisPoints: 0 }], expectedVersion: 0 })).status, 422, 'a deposit is required');
  await setSetting('hirePurchase.plans', [PLAN]);
  termsVersion = await setSetting('hirePurchase.agreementTerms', 'Test agreement wording.');
  const open = (await person('GET', '/me/hire-purchase/buying')).body.data;
  assert.equal(open.open, true);
  assert.equal(open.terms, 'Test agreement wording.');
  assert.equal(open.availableMinor, 5000_00);
});

test('a quote uses the owner\'s plan and adds up to the pesewa', async () => {
  const person = await approve('quoter');
  const { figures, withinLimit } = (await person('POST', '/me/hire-purchase/quote', { sku: SKU, planId: PLAN.id, fulfilment: { method: 'pickup' } })).body.data;
  assert.equal(figures.depositMinor, DUE_NOW);
  assert.equal(figures.chargeMinor, 80_00);
  assert.equal(figures.hirePurchasePriceMinor, HP_PRICE);
  assert.deepEqual(figures.instalments.map(item => item.amountMinor), [29333, 29333, 29334]);
  assert.equal(figures.instalments.reduce((sum, item) => sum + item.amountMinor, 0), FINANCED);
  assert.equal(withinLimit, true);
  assert.equal((await person('POST', '/me/hire-purchase/quote', { sku: PLAIN_SKU, planId: PLAN.id, fulfilment: { method: 'pickup' } })).body.error.code, 'item_unavailable', 'admin must have marked the product');
  assert.equal((await person('POST', '/me/hire-purchase/quote', { sku: SKU, planId: 'made-up', fulfilment: { method: 'pickup' } })).status, 422);
});

test('accepting checks the wording, the figures and the limit, then holds the product', async () => {
  const person = await approve('buyer', 900_00);
  assert.equal((await accept(person, { accepted: false })).status, 422);
  assert.equal((await accept(person, { termsVersion: termsVersion + 1 })).body.error.code, 'stale_version');
  assert.equal((await accept(person, { expectedDueNowMinor: 1 })).body.error.code, 'price_changed');
  assert.equal((await accept(await approve('small', 100_00))).body.error.code, 'limit_exceeded');

  const before = await stock(SKU);
  const idempotencyKey = key();
  const created = await accept(person, {}, idempotencyKey);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const agreement = created.body.data;
  assert.equal(agreement.status, 'awaiting_deposit');
  assert.equal(agreement.terms.wording, 'Test agreement wording.', 'the exact wording is kept');
  assert.equal(agreement.instalments[0].dueDate, null, 'no dates until the deposit is paid');
  assert.equal((await stock(SKU)).reserved, before.reserved + 1);
  const replay = await accept(person, {}, idempotencyKey);
  assert.equal(replay.body.data.id, agreement.id, 'a double click makes one agreement');
  assert.equal((await stock(SKU)).reserved, before.reserved + 1);

  assert.equal((await person('GET', '/me/hire-purchase/buying')).body.data.availableMinor, 20_00, 'the balance counts against the approval');
  assert.equal((await accept(person)).body.error.code, 'limit_exceeded', 'it cannot be spent twice');

  const other = customer('someone-else');
  assert.equal((await other('GET', `/me/hire-purchase/agreements/${agreement.id}`)).status, 404);
  assert.equal((await other('POST', `/me/hire-purchase/agreements/${agreement.id}/deposit`, {})).status, 404);

  const deposit = await person('POST', `/me/hire-purchase/agreements/${agreement.id}/deposit`, {});
  assert.equal(deposit.status, 200);
  const init = payments.initialized.at(-1);
  assert.equal(init.amountMinor, DUE_NOW);
  assert.equal(init.reference, agreement.orderReference);
  assert.ok(init.callbackUrl.endsWith(`/hire-purchase/agreements/${agreement.id}`));
});

test('paying the deposit starts the agreement, takes the stock and sets monthly dates', async () => {
  const person = await approve('starter');
  const before = await stock(SKU);
  const agreement = await activeAgreement(person);
  assert.equal(agreement.status, 'active');
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(agreement.instalments.map(item => item.dueDate), [1, 2, 3].map(months => addMonths(today, months)));
  assert.equal(agreement.instalments[0].overdue, false);
  const after = await stock(SKU);
  assert.equal(after.onHand, before.onHand - 1);
  assert.equal(after.reserved, before.reserved);
  assert.equal((await owner.get(`/admin/orders/${agreement.orderReference}`)).body.data.agreementId, agreement.id);
});

test('month ends are kept sensible', () => {
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2027-11-15', 3), '2028-02-15');
});

test('a wrong deposit amount never starts the agreement', async () => {
  const person = await approve('short-payer');
  const { body: { data: agreement } } = await accept(person);
  await webhook(agreement.orderReference, 1_00);
  assert.equal((await person('GET', `/me/hire-purchase/agreements/${agreement.id}`)).body.data.status, 'awaiting_deposit');
});

test('an unpaid deposit expires, freeing the product and the approved amount', async () => {
  const person = await approve('walker');
  const before = await stock(SKU);
  const { body: { data: agreement } } = await accept(person);
  await server.db.collection(C.orders).doc(agreement.orderReference).update({ reservationExpiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal((await person('POST', `/me/hire-purchase/agreements/${agreement.id}/deposit`, {})).body.error.code, 'order_expired');
  await expireDueOrders(server.db);
  const closed = (await person('GET', `/me/hire-purchase/agreements/${agreement.id}`)).body.data;
  assert.equal(closed.status, 'cancelled');
  assert.equal(closed.cancelReason, 'deposit_not_paid');
  assert.equal((await stock(SKU)).reserved, before.reserved);
  assert.equal((await person('GET', '/me/hire-purchase/buying')).body.data.availableMinor, 5000_00);
});

test('instalments are paid one at a time, safely, until the agreement completes', async () => {
  const person = await approve('payer');
  const agreement = await activeAgreement(person);
  const path = `/me/hire-purchase/agreements/${agreement.id}`;
  assert.equal((await person('POST', `${path}/pay`, {})).status, 200);
  const { reference, amountMinor } = payments.initialized.at(-1);
  assert.equal(amountMinor, 29333);
  await person('POST', `${path}/pay`, {});
  assert.equal(payments.initialized.at(-1).reference, reference, 'a retry reuses the same payment');

  await webhook(reference, 1_00);
  let current = (await person('GET', path)).body.data;
  assert.equal(current.instalments[0].status, 'due', 'a wrong amount does not count');
  assert.equal(current.paymentPending, true, 'the page keeps checking until the payment settles');
  assert.equal((await owner.get(`/admin/agreements/${agreement.id}`)).body.data.attention, 'payment_mismatch');

  payments.verifyResult = { success: true, amountMinor: 29333, currency: 'GHS', providerId: '9', paidAt: new Date().toISOString() };
  current = (await person('POST', `${path}/verify`, {})).body.data;
  assert.equal(current.instalments[0].status, 'paid');
  assert.equal(current.nextInstalmentNumber, 2);
  assert.equal(current.paymentPending, false);
  assert.equal(current.outstandingMinor, FINANCED - 29333);
  await webhook(reference, 29333);
  assert.equal((await person('GET', path)).body.data.instalments[1].status, 'due', 'the webhook arriving too changes nothing');

  await person('POST', `${path}/pay`, {});
  await webhook(payments.initialized.at(-1).reference, 29333);
  await person('POST', `${path}/pay`, {});
  assert.equal(payments.initialized.at(-1).amountMinor, 29334, 'the remainder is on the last one');
  await webhook(payments.initialized.at(-1).reference, 29334);
  current = (await person('GET', path)).body.data;
  assert.equal(current.status, 'completed');
  assert.equal(current.outstandingMinor, 0);
  assert.equal((await person('POST', `${path}/pay`, {})).status, 409);
  assert.equal((await person('GET', '/me/hire-purchase/buying')).body.data.availableMinor, 5000_00, 'paying it off frees the approval');
});

test('finance records payments taken in person, and roles limit who can', async () => {
  const person = await approve('cash-payer');
  const agreement = await activeAgreement(person);
  const finance = await staffClient(server.base, owner, { email: 'finance@example.test', roles: ['finance'] });
  const fulfilment = await staffClient(server.base, owner, { email: 'fulfil@example.test', roles: ['fulfilment'] });
  assert.equal((await fulfilment.client.get('/admin/agreements')).status, 403);
  assert.equal((await fulfilment.client.post(`/admin/agreements/${agreement.id}/payments`, { method: 'cash', note: 'x', expectedVersion: agreement.version })).status, 403);
  assert.equal((await fetch(`${server.base}/admin/agreements`)).status, 401);
  assert.equal((await finance.client.post(`/admin/agreements/${agreement.id}/payments`, { method: 'cash', note: 'x', expectedVersion: agreement.version - 1 })).body.error.code, 'stale_version');

  const paid = await finance.client.post(`/admin/agreements/${agreement.id}/payments`, { method: 'cash', note: 'Receipt 104', expectedVersion: agreement.version });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.data.instalments[0].status, 'paid');
  assert.equal(paid.body.data.instalments[0].paymentMethod, 'cash');
  const events = await owner.get(`/admin/audit-events?resourceType=hp_agreement&resourceId=${agreement.id}&limit=50`);
  assert.ok(events.body.data.items.some(event => event.action === 'agreement.instalment_paid' && event.actorId === finance.id));

  const list = await finance.client.get('/admin/agreements?status=active');
  assert.ok(list.body.data.items.some(item => item.id === agreement.id));
  assert.equal((await finance.client.post(`/admin/agreements/${agreement.id}/cancel`, { reason: 'x', expectedVersion: paid.body.data.version })).status, 403, 'finance cannot end agreements');
  const ended = await owner.post(`/admin/agreements/${agreement.id}/cancel`, { reason: 'Customer returned the goods.', expectedVersion: paid.body.data.version });
  assert.equal(ended.body.data.status, 'cancelled');
  assert.equal((await person('POST', `/me/hire-purchase/agreements/${agreement.id}/pay`, {})).status, 409);
  assert.equal((await person('GET', `/me/hire-purchase/agreements/${agreement.id}`)).body.data.cancelNote, undefined, 'staff notes stay with staff');
});
