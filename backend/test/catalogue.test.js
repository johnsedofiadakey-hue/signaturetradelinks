import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { client, createCategory, createProduct, ownerClient, startTestServer, staffClient } from './helpers.js';

describe('catalogue lifecycle', () => {
  let server;
  let owner;
  let category;
  const publicClient = () => client(server.base);

  before(async () => {
    server = await startTestServer();
    owner = await ownerClient(server.base);
    category = await createCategory(owner);
  });
  after(() => server.close());

  test('draft products are hidden from the public catalogue', async () => {
    const product = await createProduct(owner, category.id, { slug: 'draft-only', title: 'Draft only' });
    assert.equal(product.publishStatus, 'draft');
    const list = await publicClient().get('/products');
    assert.ok(!list.body.data.items.some(p => p.id === product.id));
    assert.equal((await publicClient().get('/products/draft-only')).status, 404);
  });

  test('publishing requires a complete product', async () => {
    const product = await createProduct(owner, category.id, { slug: 'incomplete', title: 'Incomplete', description: '', images: [] });
    const result = await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version });
    assert.equal(result.status, 422);
    assert.equal(result.body.error.code, 'not_ready');
    assert.ok(result.body.error.fieldErrors.description);
    assert.ok(result.body.error.fieldErrors.images);
  });

  test('publish, unpublish, archive and restore follow the state machine', async () => {
    let product = await createProduct(owner, category.id, { slug: 'lifecycle', title: 'Lifecycle' });
    const publish = await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version });
    assert.equal(publish.status, 200);
    product = publish.body.data;
    assert.equal(product.publishStatus, 'published');
    assert.equal((await publicClient().get('/products/lifecycle')).status, 200);

    const restoreLive = await owner.post(`/admin/products/${product.id}/transitions`, { action: 'restore', expectedVersion: product.version });
    assert.equal(restoreLive.status, 409);
    assert.equal(restoreLive.body.error.code, 'invalid_transition');

    product = (await owner.post(`/admin/products/${product.id}/transitions`, { action: 'archive', expectedVersion: product.version, reason: 'Discontinued' })).body.data;
    assert.equal(product.publishStatus, 'archived');
    assert.equal((await publicClient().get('/products/lifecycle')).status, 404);

    product = (await owner.post(`/admin/products/${product.id}/transitions`, { action: 'restore', expectedVersion: product.version })).body.data;
    assert.equal(product.publishStatus, 'draft');
  });

  test('concurrent edits with the same version: one wins, the other gets 409', async () => {
    const product = await createProduct(owner, category.id, { slug: 'concurrent', title: 'Concurrent' });
    const [a, b] = await Promise.all([
      owner.patch(`/admin/products/${product.id}`, { title: 'Edit A', expectedVersion: product.version }),
      owner.patch(`/admin/products/${product.id}`, { title: 'Edit B', expectedVersion: product.version }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal([a, b].find(r => r.status === 409).body.error.code, 'stale_version');
  });

  test('a published product cannot change its web address', async () => {
    let product = await createProduct(owner, category.id, { slug: 'locked-slug', title: 'Locked slug' });
    product = (await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version })).body.data;
    const result = await owner.patch(`/admin/products/${product.id}`, { slug: 'new-slug', expectedVersion: product.version });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'slug_locked');
  });

  test('a published product cannot be edited into an incomplete state', async () => {
    let product = await createProduct(owner, category.id, { slug: 'stay-complete', title: 'Stay complete' });
    product = (await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version })).body.data;
    const result = await owner.patch(`/admin/products/${product.id}`, { images: [], expectedVersion: product.version });
    assert.equal(result.status, 422);
    const reloaded = (await owner.get(`/admin/products/${product.id}`)).body.data;
    assert.equal(reloaded.images.length, 1);
  });

  test('validation rejects unknown fields and unsafe image sources', async () => {
    const result = await owner.post('/admin/products', {
      slug: 'Bad Slug', title: 'X', categoryId: category.id, images: [{ src: 'javascript:alert(1)', alt: 'x' }], isAdmin: true,
    });
    assert.equal(result.status, 422);
    assert.ok(result.body.error.fieldErrors.slug);
    assert.ok(result.body.error.fieldErrors.images);
    assert.equal(result.body.error.fieldErrors.isAdmin, 'Unknown field.');
  });

  test('public search is case-insensitive, filters hire purchase and paginates with a cursor', async () => {
    for (const [slug, title] of [['zz-alpha', 'ZZ Alpha speaker'], ['zz-beta', 'zz beta speaker'], ['zz-gamma', 'ZZ Gamma speaker']]) {
      const product = await createProduct(owner, category.id, { slug, title });
      await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version });
    }
    const first = await publicClient().get('/products?q=zZ&limit=2');
    assert.equal(first.body.data.items.length, 2);
    assert.ok(first.body.data.nextCursor);
    const second = await publicClient().get(`/products?q=zz&limit=2&cursor=${first.body.data.nextCursor}`);
    assert.equal(second.body.data.items.length, 1);
    assert.equal(second.body.data.nextCursor, null);
    const titles = [...first.body.data.items, ...second.body.data.items].map(p => p.title);
    assert.deepEqual(titles, ['ZZ Alpha speaker', 'zz beta speaker', 'ZZ Gamma speaker']);

    const hire = await publicClient().get('/products?hirePurchase=true');
    assert.equal(hire.body.data.items.length, 0);
    assert.equal((await publicClient().get('/products?cursor=garbage')).status, 422);
  });

  test('only owner or approver can change hire-purchase eligibility, and a reason is required', async () => {
    let product = await createProduct(owner, category.id, { slug: 'hp-eligible', title: 'HP eligible' });
    const noReason = await owner.post(`/admin/products/${product.id}/hire-purchase`, { enabled: true, expectedVersion: product.version });
    assert.equal(noReason.status, 422);
    const { client: approver } = await staffClient(server.base, owner, { email: 'approver@example.test', roles: ['approver'] });
    const enabled = await approver.post(`/admin/products/${product.id}/hire-purchase`, { enabled: true, expectedVersion: product.version, reason: 'Approved policy v1' });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.data.hirePurchaseEnabled, true);
    // Approvers cannot otherwise edit the catalogue.
    product = enabled.body.data;
    assert.equal((await approver.patch(`/admin/products/${product.id}`, { title: 'Nope', expectedVersion: product.version })).status, 403);
  });

  test('hire-purchase eligibility can be set while adding a product, with permission and a reason', async () => {
    const noReason = await owner.post('/admin/products', { slug: 'hp-at-create-0', title: 'HP at create', categoryId: category.id, hirePurchase: { enabled: true, reason: null } });
    assert.equal(noReason.status, 422);
    assert.ok(noReason.body.error.fieldErrors['hirePurchase.reason']);

    const created = await owner.post('/admin/products', { slug: 'hp-at-create', title: 'HP at create', categoryId: category.id, hirePurchase: { enabled: true, reason: 'Approved for HP range' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.hirePurchaseEnabled, true);
    const events = (await owner.get(`/admin/audit-events?resourceType=product&resourceId=${created.body.data.id}`)).body.data.items;
    assert.ok(events.some(e => e.action === 'product.hire_purchase_changed' && e.metadata.reason === 'Approved for HP range'));

    const { client: manager } = await staffClient(server.base, owner, { email: 'cm-hp@example.test', roles: ['catalogue_manager'] });
    const blocked = await manager.post('/admin/products', { slug: 'hp-by-manager', title: 'HP by manager', categoryId: category.id, hirePurchase: { enabled: true, reason: 'Trying' } });
    assert.equal(blocked.status, 403);
    const retailOnly = await manager.post('/admin/products', { slug: 'retail-by-manager', title: 'Retail by manager', categoryId: category.id, hirePurchase: { enabled: false, reason: null } });
    assert.equal(retailOnly.status, 201);
    assert.equal(retailOnly.body.data.hirePurchaseEnabled, false);

    const hpStore = (await owner.get('/admin/products?store=hire_purchase')).body.data.items;
    assert.ok(hpStore.length > 0 && hpStore.every(p => p.hirePurchaseEnabled));
    assert.ok(hpStore.some(p => p.slug === 'hp-at-create'));
    assert.equal((await owner.get('/admin/products?store=nope')).status, 422);
  });
});

describe('prices and currency', () => {
  let server;
  let owner;
  let product;
  before(async () => {
    server = await startTestServer();
    owner = await ownerClient(server.base);
    const category = await createCategory(owner);
    product = await createProduct(owner, category.id);
    product = (await owner.post(`/admin/products/${product.id}/transitions`, { action: 'publish', expectedVersion: product.version })).body.data;
  });
  after(() => server.close());

  test('a price cannot be set until the owner confirms the store currency', async () => {
    const result = await owner.post(`/admin/products/${product.id}/variants`, { sku: 'HP-BLK', retailPriceMinor: 120000, currency: 'GHS' });
    assert.equal(result.status, 422);
    assert.equal(result.body.error.code, 'commercial_setting_missing');
    const unpriced = await owner.post(`/admin/products/${product.id}/variants`, { sku: 'HP-BLK', attributes: { colour: 'Black' } });
    assert.equal(unpriced.status, 201);
    assert.equal(unpriced.body.data.retailPriceMinor, null);
    const detail = (await client(server.base).get(`/products/${product.slug}`)).body.data;
    assert.equal(detail.price, null);
    assert.equal(detail.availability, 'unconfirmed');
  });

  test('once currency is set, prices must use it and are exposed publicly in minor units', async () => {
    const settings = (await owner.get('/admin/settings')).body.data;
    const currency = settings.find(s => s.key === 'store.currency');
    assert.equal(currency.configured, false);
    const set = await owner.put('/admin/settings/store.currency', { value: 'GHS', expectedVersion: currency.version });
    assert.equal(set.status, 200);

    const wrong = await owner.post(`/admin/products/${product.id}/variants`, { sku: 'HP-WHT', retailPriceMinor: 99900, currency: 'USD' });
    assert.equal(wrong.status, 422);
    assert.ok(wrong.body.error.fieldErrors.currency);
    const floaty = await owner.post(`/admin/products/${product.id}/variants`, { sku: 'HP-WHT', retailPriceMinor: 999.5, currency: 'GHS' });
    assert.equal(floaty.status, 422);
    const priced = await owner.post(`/admin/products/${product.id}/variants`, { sku: 'HP-WHT', retailPriceMinor: 99900, currency: 'GHS' });
    assert.equal(priced.status, 201);

    const detail = (await client(server.base).get(`/products/${product.slug}`)).body.data;
    assert.deepEqual(detail.price, { fromAmountMinor: 99900, currency: 'GHS', varies: false });
    assert.equal(detail.availability, 'out_of_stock');
    assert.deepEqual(detail.purchaseModes.retail, { available: false, reason: 'checkout_not_configured' });
  });

  test('changing the store currency is blocked while variants are priced in the old one', async () => {
    const currency = (await owner.get('/admin/settings')).body.data.find(s => s.key === 'store.currency');
    const result = await owner.put('/admin/settings/store.currency', { value: 'USD', expectedVersion: currency.version });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'currency_in_use');
  });
});
