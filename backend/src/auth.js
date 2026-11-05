import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { permissionsFor } from '../../shared/contract.js';
import { fail, parseCookies, serializeCookie } from './http.js';
import { C, now, sha256, transaction } from './firestore.js';

export { sha256 };

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

// Firebase Hosting forwards only a cookie named __session to the API, so the session must use that name.
export const SESSION_COOKIE = '__session';
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

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createSession(db, staffId, ttlMs) {
  const token = randomToken();
  const csrfToken = randomToken();
  await db.collection(C.sessions).doc(sha256(token)).create({
    staffId, csrfToken, createdAt: now(), expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  });
  return { token, csrfToken };
}

/** Delete every session for a staff member, inside a transaction. Call after the transaction's other reads. */
export async function revokeSessions(db, tx, staffId) {
  const sessions = await tx.get(db.collection(C.sessions).where('staffId', '==', staffId));
  return () => sessions.docs.forEach(doc => tx.delete(doc.ref));
}

export function sessionCookie(token, config) {
  return serializeCookie(SESSION_COOKIE, token, {
    path: '/api/v1/admin', secure: config.secureCookies, maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(config) {
  return serializeCookie(SESSION_COOKIE, '', { path: '/api/v1/admin', secure: config.secureCookies, maxAgeSeconds: 0 });
}

export const publicStaff = (id, data) => ({
  id, email: data.email, displayName: data.displayName, roles: [...data.roles].sort(), permissions: permissionsFor(data.roles),
});

/** Resolve the signed-in staff member from the session cookie, or null. */
export async function loadSession(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const sessionRef = db.collection(C.sessions).doc(sha256(token));
  const session = await sessionRef.get();
  if (!session.exists || session.data().expiresAt <= now()) return null;
  const staff = await db.collection(C.staff).doc(session.data().staffId).get();
  if (!staff.exists || staff.data().status !== 'active') return null;
  return { ref: sessionRef, csrfToken: session.data().csrfToken, staff: publicStaff(staff.id, staff.data()) };
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
export async function requireStaff(ctx, permission) {
  const session = await loadSession(ctx.db, ctx.req);
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

/** Fixed-window limiter stored in Firestore, so it holds across every server instance. */
export class RateLimiter {
  constructor(db, { name, limit, windowMs }) {
    this.db = db;
    this.name = name;
    this.limit = limit;
    this.windowMs = windowMs;
  }

  ref(key) {
    return this.db.collection(C.rateLimits).doc(sha256(`${this.name}\n${key}`));
  }

  async check(key) {
    const snap = await this.ref(key).get();
    const entry = snap.data();
    if (!entry || entry.resetAt <= Date.now() || entry.count < this.limit) return;
    fail('rate_limited', 'Too many attempts. Please wait and try again.', {
      headers: { 'Retry-After': String(Math.ceil((entry.resetAt - Date.now()) / 1000)) },
    });
  }

  record(key) {
    const ref = this.ref(key);
    return transaction(this.db, async tx => {
      const entry = (await tx.get(ref)).data();
      if (!entry || entry.resetAt <= Date.now()) tx.set(ref, { count: 1, resetAt: Date.now() + this.windowMs });
      else tx.update(ref, { count: entry.count + 1 });
    });
  }

  reset(key) {
    return this.ref(key).delete();
  }
}
