import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { permissionsFor } from '../../shared/contract.js';
import { fail, parseCookies, serializeCookie } from './http.js';
import { now } from './db.js';

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export const SESSION_COOKIE = 'stl_admin_session';
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expectedKey = Buffer.from(expected, 'base64url');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expectedKey.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(key, expectedKey);
}

// Verified against when an email is unknown so response timing does not reveal which accounts exist.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
}

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSession(db, staffId, ttlMs) {
  const token = randomToken();
  const csrfToken = randomToken();
  const createdAt = now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt);
  db.prepare('INSERT INTO sessions (token_hash, staff_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), staffId, csrfToken, createdAt, new Date(Date.now() + ttlMs).toISOString());
  return { token, csrfToken };
}

export function sessionCookie(token, config) {
  return serializeCookie(SESSION_COOKIE, token, {
    path: '/api/v1/admin', secure: config.secureCookies, maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(config) {
  return serializeCookie(SESSION_COOKIE, '', { path: '/api/v1/admin', secure: config.secureCookies, maxAgeSeconds: 0 });
}

export function rolesFor(db, staffId) {
  return db.prepare('SELECT role FROM staff_roles WHERE staff_id = ? ORDER BY role').all(staffId).map(row => row.role);
}

/** Resolve the signed-in staff member from the session cookie, or null. */
export function loadSession(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token_hash, s.csrf_token, s.expires_at, st.id, st.email, st.display_name, st.status
    FROM sessions s JOIN staff st ON st.id = s.staff_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at <= now() || row.status !== 'active') return null;
  const roles = rolesFor(db, row.id);
  return {
    tokenHash: row.token_hash,
    csrfToken: row.csrf_token,
    staff: { id: row.id, email: row.email, displayName: row.display_name, roles, permissions: permissionsFor(roles) },
  };
}

const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

export function checkOrigin(req, config) {
  const origin = req.headers.origin;
  // Same-origin form posts and non-browser clients may omit Origin; the CSRF token still applies.
  if (!origin || config.allowedOrigins.includes(origin)) return;
  if (config.allowLoopbackOrigins && LOOPBACK_ORIGIN.test(origin)) return;
  fail('csrf_failed', 'This request was blocked.');
}

/** Require an active staff session, an optional permission, and CSRF protection on writes. */
export function requireStaff(ctx, permission) {
  const session = loadSession(ctx.db, ctx.req);
  if (!session) fail('unauthenticated', 'Please sign in to continue.');
  if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
    checkOrigin(ctx.req, ctx.config);
    const header = ctx.req.headers['x-csrf-token'];
    if (!header || !safeEqual(header, session.csrfToken)) fail('csrf_failed', 'This request was blocked. Refresh the page and try again.');
  }
  if (permission && !session.staff.permissions.includes(permission)) fail('forbidden', 'You do not have permission to do that.');
  ctx.session = session;
  return session.staff;
}

/** Fixed-window limiter. In-memory, so per-process; move to a shared store before running multiple instances. */
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  check(key) {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= Date.now()) return;
    if (entry.count >= this.limit) {
      const retryAfter = Math.ceil((entry.resetAt - Date.now()) / 1000);
      fail('rate_limited', 'Too many attempts. Please wait and try again.', { headers: { 'Retry-After': String(retryAfter) } });
    }
  }

  record(key) {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= Date.now()) this.hits.set(key, { count: 1, resetAt: Date.now() + this.windowMs });
    else entry.count += 1;
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= Date.now()) this.hits.delete(k);
  }

  reset(key) {
    this.hits.delete(key);
  }
}
