import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openFirestore } from '../src/firestore.js';
import { bootstrapOwner } from '../src/routes/admin-staff.js';

export const ORIGIN = 'http://127.0.0.1:5173';
export const OWNER = { email: 'owner@example.test', displayName: 'Test Owner', password: 'owner-password-123' };

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run tests with `npm test` so they use the Firestore emulator.');

/** Start an API server on an ephemeral port backed by its own emulator project, so every suite starts empty. */
export async function startTestServer({ payments, customerAuth, signInEmail, documents, config: overrides } = {}) {
  const projectId = `demo-stl-${randomUUID().slice(0, 8)}`;
  const db = openFirestore(projectId);
  const config = { ...loadConfig({}), projectId, logRequests: false, orderRateLimit: 1000, ...overrides };
  const server = createServer(createApp({ db, config, log: { error: console.error, info() {} }, ...(payments ? { payments } : {}), ...(customerAuth ? { customerAuth } : {}), ...(signInEmail ? { signInEmail } : {}), ...(documents ? { documents } : {}) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  await bootstrapOwner(db, OWNER);
  return { db, projectId, base, close: () => new Promise(resolve => server.close(resolve)) };
}

/** Minimal browser-like client: keeps the session cookie and sends the CSRF token on writes. */
export function client(base, { origin = ORIGIN } = {}) {
  let cookie = '';
  let csrfToken = '';
  async function request(method, path, body, { headers = {}, csrf = true } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf && csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.data?.csrfToken) csrfToken = json.data.csrfToken;
    return { status: response.status, body: json, headers: response.headers };
  }
  return {
    request,
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body = {}, options) => request('POST', path, body, options),
    patch: (path, body, options) => request('PATCH', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    login: (email, password) => request('POST', '/admin/auth/login', { email, password }),
    get cookie() { return cookie; },
  };
}

export async function ownerClient(base) {
  const owner = client(base);
  const result = await owner.login(OWNER.email, OWNER.password);
  if (result.status !== 200) throw new Error(`Owner login failed: ${JSON.stringify(result.body)}`);
  return owner;
}

/** Invite a staff member as the owner, accept the invite, and return a signed-in client. */
export async function staffClient(base, owner, { email, roles, password = 'staff-password-123' }) {
  const invited = await owner.post('/admin/staff', { email, displayName: email.split('@')[0], roles });
  if (invited.status !== 201) throw new Error(`Invite failed: ${JSON.stringify(invited.body)}`);
  const accepted = await client(base).post('/admin/auth/accept-invite', { email, token: invited.body.data.inviteToken, password });
  if (accepted.status !== 204) throw new Error(`Accept failed: ${JSON.stringify(accepted.body)}`);
  const staff = client(base);
  await staff.login(email, password);
  return { client: staff, id: invited.body.data.staff.id };
}

export async function createCategory(owner, overrides = {}) {
  const result = await owner.post('/admin/categories', { slug: 'audio', label: 'Audio', sortOrder: 10, published: true, ...overrides });
  if (result.status !== 201) throw new Error(JSON.stringify(result.body));
  return result.body.data;
}

export async function createProduct(owner, categoryId, overrides = {}) {
  const result = await owner.post('/admin/products', {
    slug: 'test-headphones',
    title: 'Test headphones',
    description: 'Fixture product for automated tests.',
    categoryId,
    images: [{ src: '/headphones.jpg', alt: 'Test headphones' }],
    ...overrides,
  });
  if (result.status !== 201) throw new Error(JSON.stringify(result.body));
  return result.body.data;
}
