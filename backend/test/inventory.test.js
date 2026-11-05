import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, createCategory, createProduct, ownerClient, startTestServer, staffClient } from './helpers.js';

describe('inventory ledger', () => {
  let server;
  let owner;
  let product;
  const SKU = 'TV-55';
  let keyCounter = 0;
  const key = () => `test-key-${++keyCounter}-${Date.now()}`;
  const adjust = (as, body, idempotencyKey = key()) => as.post('/admin/inventory/movements', body, { headers: { 'Idempotency-Key': idempotencyKey } });

  before(async () => {
    server = await startTestServer();
    owner = await ownerClient(server.base);
    const category = await createCategory(owner, { slug: 'tv', label: 'TV' });
    product = await createProduct(owner, category.id, { slug: 'tv-55', title: 'Television 55' });
    await owner.post(`/admin/products/${product.id}/variants`, { sku: SKU });
  });
  after(() => server.close());

  test('an Idempotency-Key is required', async () => {
    const result = await owner.post('/admin/inventory/movements', { sku: SKU, quantity: 1, reason: 'stock_received' });
    assert.equal(result.status, 422);
  });

  test('receiving stock is idempotent: a replay does not double the stock', async () => {
    const idempotencyKey = key();
    const first = await adjust(owner, { sku: SKU, quantity: 5, reason: 'stock_received' }, idempotencyKey);
    const replay = await adjust(owner, { sku: SKU, quantity: 5, reason: 'stock_received' }, idempotencyKey);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(replay.body.data, first.body.data);
    assert.equal(first.body.data.stock.onHand, 5);
    const movements = (await owner.get(`/admin/inventory/movements?sku=${SKU}`)).body.data.items;
    assert.equal(movements.length, 1);
  });

  test('reusing an Idempotency-Key with a different payload is rejected', async () => {
    const idempotencyKey = key();
    await adjust(owner, { sku: SKU, quantity: 1, reason: 'stock_received' }, idempotencyKey);
    const reuse = await adjust(owner, { sku: SKU, quantity: 50, reason: 'stock_received' }, idempotencyKey);
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.error.code, 'idempotency_key_reused');
  });

  test('reason rules enforce direction and explanations', async () => {
    const wrongSign = await adjust(owner, { sku: SKU, quantity: -1, reason: 'stock_received' });
    assert.equal(wrongSign.status, 422);
    const noNote = await adjust(owner, { sku: SKU, quantity: -1, reason: 'damaged' });
    assert.equal(noNote.status, 422);
    assert.ok(noNote.body.error.fieldErrors.note);
  });

  test('stock can never go below zero', async () => {
    const current = (await owner.get(`/admin/inventory?q=${SKU}`)).body.data.items[0];
    const result = await adjust(owner, { sku: SKU, quantity: -(current.onHand + 1), reason: 'count_correction', note: 'Recount' });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'insufficient_stock');
  });

  test('concurrent removals of the last unit: exactly one succeeds', async () => {
    const current = (await owner.get(`/admin/inventory?q=${SKU}`)).body.data.items[0];
    if (current.onHand > 1) await adjust(owner, { sku: SKU, quantity: -(current.onHand - 1), reason: 'count_correction', note: 'Set to one' });
    const results = await Promise.all([1, 2, 3].map(() => adjust(owner, { sku: SKU, quantity: -1, reason: 'damaged', note: 'Dropped' })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409, 409]);
    const after = (await owner.get(`/admin/inventory?q=${SKU}`)).body.data.items[0];
    assert.equal(after.onHand, 0);
  });

  test('the ledger is append-only at the database level', () => {
    assert.throws(() => server.db.prepare('UPDATE inventory_movements SET quantity = 999').run(), /immutable/);
    assert.throws(() => server.db.prepare('DELETE FROM inventory_movements').run(), /immutable/);
    assert.throws(() => server.db.prepare('DELETE FROM audit_events').run(), /immutable/);
  });

  test('fulfilment can view stock but not adjust it', async () => {
    const { client: fulfilment } = await staffClient(server.base, owner, { email: 'ff@example.test', roles: ['fulfilment'] });
    assert.equal((await fulfilment.get('/admin/inventory')).status, 200);
    assert.equal((await adjust(fulfilment, { sku: SKU, quantity: 1, reason: 'stock_received' })).status, 403);
  });

  test('every adjustment is audited with before and after stock', async () => {
    const events = (await owner.get('/admin/audit-events?resourceType=variant_stock')).body.data.items;
    assert.ok(events.length >= 3);
    assert.ok(events.every(e => e.action === 'inventory.adjusted' && e.before && e.after && e.actorId));
  });
});

describe('services that are not configured yet', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(() => server.close());

  test('checkout, orders, hire purchase and webhooks fail loudly with 503', async () => {
    const anonymous = client(server.base);
    for (const [method, path] of [
      ['POST', '/checkout/quote'], ['POST', '/orders'], ['POST', '/hire-purchase/applications'],
      ['GET', '/me/orders'], ['POST', '/webhooks/provider'], ['POST', '/me/offers/off_1/accept'],
    ]) {
      const result = await anonymous.request(method, path, method === 'POST' ? {} : undefined);
      assert.equal(result.status, 503, `${method} ${path}`);
      assert.equal(result.body.error.code, 'not_configured');
      assert.equal(result.body.data, undefined);
    }
  });

  test('unknown routes return 404 JSON and wrong methods return 405', async () => {
    const anonymous = client(server.base);
    const missing = await anonymous.get('/nope');
    assert.equal(missing.status, 404);
    assert.ok(missing.body.requestId);
    assert.equal((await anonymous.request('DELETE', '/products')).status, 405);
  });
});
