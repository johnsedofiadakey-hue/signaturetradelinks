import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, client, ownerClient, startTestServer, staffClient } from './helpers.js';

describe('staff authentication', () => {
  let server;
  before(async () => { server = await startTestServer(); });
  after(() => server.close());

  test('owner can sign in and the session cookie is HttpOnly and SameSite=Strict', async () => {
    const owner = client(server.base);
    const result = await owner.login(OWNER.email, OWNER.password);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.staff.roles, ['owner']);
    assert.ok(result.body.data.csrfToken);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/v1\/admin/);
    assert.equal((await owner.get('/admin/auth/session')).status, 200);
  });

  test('wrong password and unknown email return the same error (no account enumeration)', async () => {
    const wrong = await client(server.base).login(OWNER.email, 'not-the-password');
    const unknown = await client(server.base).login('nobody@example.test', 'not-the-password');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body.error, unknown.body.error);
  });

  test('repeated failures for an account are rate limited', async () => {
    const attacker = client(server.base);
    let last;
    for (let i = 0; i < 6; i++) last = await attacker.login('limited@example.test', 'wrong-password');
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  });

  test('admin endpoints require a session', async () => {
    const anonymous = client(server.base);
    for (const path of ['/admin/products', '/admin/staff', '/admin/settings', '/admin/audit-events', '/admin/dashboard']) {
      assert.equal((await anonymous.get(path)).status, 401, path);
    }
  });

  test('writes without the CSRF token, or from a foreign origin, are blocked', async () => {
    const owner = await ownerClient(server.base);
    const noToken = await owner.post('/admin/categories', { slug: 'x', label: 'X', sortOrder: 1, published: true }, { csrf: false });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.error.code, 'csrf_failed');
    const foreign = await owner.post('/admin/categories', { slug: 'x', label: 'X', sortOrder: 1, published: true }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const loginFromForeign = await client(server.base, { origin: 'https://evil.example' }).login(OWNER.email, OWNER.password);
    assert.equal(loginFromForeign.status, 403);
  });

  test('non-JSON bodies are rejected so cross-site simple form posts cannot reach handlers', async () => {
    const response = await fetch(`${server.base}/admin/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
    });
    assert.equal(response.status, 415);
  });

  test('logout ends the session', async () => {
    const owner = await ownerClient(server.base);
    assert.equal((await owner.post('/admin/auth/logout')).status, 204);
    assert.equal((await owner.get('/admin/auth/session')).status, 401);
  });

  test('invitation tokens are single use', async () => {
    const owner = await ownerClient(server.base);
    const invited = await owner.post('/admin/staff', { email: 'once@example.test', displayName: 'Once', roles: ['fulfilment'] });
    const token = invited.body.data.inviteToken;
    const first = await client(server.base).post('/admin/auth/accept-invite', { email: 'once@example.test', token, password: 'first-password-123' });
    assert.equal(first.status, 204);
    const second = await client(server.base).post('/admin/auth/accept-invite', { email: 'once@example.test', token, password: 'second-password-123' });
    assert.equal(second.status, 401);
    assert.equal((await client(server.base).login('once@example.test', 'first-password-123')).status, 200);
  });

  test('short passwords are rejected when accepting an invite', async () => {
    const owner = await ownerClient(server.base);
    const invited = await owner.post('/admin/staff', { email: 'short@example.test', displayName: 'Short', roles: ['finance'] });
    const result = await client(server.base).post('/admin/auth/accept-invite', { email: 'short@example.test', token: invited.body.data.inviteToken, password: 'short' });
    assert.equal(result.status, 422);
    assert.ok(result.body.error.fieldErrors.password);
  });
});

describe('roles and staff management', () => {
  let server;
  let owner;
  before(async () => {
    server = await startTestServer();
    owner = await ownerClient(server.base);
  });
  after(() => server.close());

  test('a catalogue manager cannot manage staff, settings, audit or hire-purchase eligibility', async () => {
    const { client: manager } = await staffClient(server.base, owner, { email: 'cm@example.test', roles: ['catalogue_manager'] });
    assert.equal((await manager.get('/admin/staff')).status, 403);
    assert.equal((await manager.get('/admin/settings')).status, 403);
    assert.equal((await manager.get('/admin/audit-events')).status, 403);
    assert.equal((await manager.post('/admin/staff', { email: 'x@example.test', displayName: 'X', roles: ['owner'] })).status, 403);
    assert.equal((await manager.post('/admin/products/prd_any/hire-purchase', { enabled: true, expectedVersion: 1, reason: 'test' })).status, 403);
  });

  test('staff cannot grant themselves roles', async () => {
    const { client: fulfilment, id } = await staffClient(server.base, owner, { email: 'ff@example.test', roles: ['fulfilment'] });
    const escalate = await fulfilment.put(`/admin/staff/${id}/roles`, { roles: ['owner'], expectedVersion: 2 });
    assert.equal(escalate.status, 403);
    const session = await fulfilment.get('/admin/auth/session');
    assert.deepEqual(session.body.data.staff.roles, ['fulfilment']);
  });

  test('the last active owner cannot be demoted', async () => {
    const me = (await owner.get('/admin/auth/session')).body.data.staff;
    const list = (await owner.get('/admin/staff')).body.data;
    const self = list.find(s => s.id === me.id);
    const result = await owner.put(`/admin/staff/${me.id}/roles`, { roles: ['catalogue_manager'], expectedVersion: self.version });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'last_owner');
    assert.deepEqual((await owner.get('/admin/auth/session')).body.data.staff.roles, ['owner']);
  });

  test('role changes and deactivation revoke the target sessions immediately', async () => {
    const { client: target, id } = await staffClient(server.base, owner, { email: 'target@example.test', roles: ['catalogue_manager'] });
    assert.equal((await target.get('/admin/products')).status, 200);
    let staff = (await owner.get('/admin/staff')).body.data.find(s => s.id === id);
    const changed = await owner.put(`/admin/staff/${id}/roles`, { roles: ['assessor'], expectedVersion: staff.version });
    assert.equal(changed.status, 200);
    assert.equal((await target.get('/admin/products')).status, 401);

    await target.login('target@example.test', 'staff-password-123');
    staff = (await owner.get('/admin/staff')).body.data.find(s => s.id === id);
    const deactivated = await owner.post(`/admin/staff/${id}/deactivate`, { expectedVersion: staff.version, reason: 'Left the business' });
    assert.equal(deactivated.status, 200);
    assert.equal((await target.get('/admin/auth/session')).status, 401);
    assert.equal((await target.login('target@example.test', 'staff-password-123')).status, 401);
  });

  test('stale role updates are rejected', async () => {
    const { id } = await staffClient(server.base, owner, { email: 'stale@example.test', roles: ['finance'] });
    const staff = (await owner.get('/admin/staff')).body.data.find(s => s.id === id);
    assert.equal((await owner.put(`/admin/staff/${id}/roles`, { roles: ['finance', 'fulfilment'], expectedVersion: staff.version })).status, 200);
    const stale = await owner.put(`/admin/staff/${id}/roles`, { roles: ['assessor'], expectedVersion: staff.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_version');
  });

  test('audit events never contain password hashes or invitation tokens', async () => {
    const rows = server.db.prepare('SELECT before_state, after_state, metadata FROM audit_events').all();
    const text = JSON.stringify(rows);
    assert.doesNotMatch(text, /scrypt\$/);
    assert.doesNotMatch(text, /password/i);
    assert.doesNotMatch(text, /inviteToken|invite_token/);
  });
});
