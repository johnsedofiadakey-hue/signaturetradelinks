import { recordAudit } from '../audit.js';
import {
  MIN_PASSWORD_LENGTH, RateLimiter, burnPasswordCheck, checkOrigin, clearSessionCookie, createSession, hashPassword,
  publicStaff, requireStaff, safeEqual, sessionCookie, sha256, verifyPassword,
} from '../auth.js';
import { C, now, read, transaction } from '../firestore.js';
import { fail } from '../http.js';
import { EMAIL, str, validate } from '../validate.js';

const credentials = {
  email: str({ max: 254, pattern: EMAIL, patternMessage: 'Enter a valid email address.' }),
  password: str({ min: 1, max: 200, trim: false }),
};

async function staffByEmail(db, email, tx) {
  const index = await read(db.collection(C.staffEmails).doc(sha256(email.toLowerCase())), tx);
  if (!index.exists) return null;
  const staff = await read(db.collection(C.staff).doc(index.data().staffId), tx);
  return staff.exists ? staff : null;
}

export function registerAdminAuth(route, db) {
  // Account limiter is keyed by email alone: forwarded IPs can be spoofed, so they cannot be the only key.
  const accountLimiter = new RateLimiter(db, { name: 'login-account', limit: 5, windowMs: 15 * 60_000 });
  const ipLimiter = new RateLimiter(db, { name: 'login-ip', limit: 30, windowMs: 15 * 60_000 });

  route('POST', '/admin/auth/login', async ctx => {
    checkOrigin(ctx.req, ctx.config);
    const { email, password } = validate(ctx.body, credentials);
    const accountKey = email.toLowerCase();
    await Promise.all([accountLimiter.check(accountKey), ipLimiter.check(ctx.ip)]);

    const staff = await staffByEmail(ctx.db, email);
    const data = staff?.data();
    const active = data?.status === 'active' && data.passwordHash;
    const valid = active ? await verifyPassword(password, data.passwordHash) : (await burnPasswordCheck(password), false);
    if (!valid) {
      await Promise.all([accountLimiter.record(accountKey), ipLimiter.record(ctx.ip)]);
      if (active) await recordAudit(ctx.db, null, { actor: null, action: 'auth.login_failed', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
      fail('invalid_credentials', 'Email or password is incorrect.');
    }
    await accountLimiter.reset(accountKey);
    const { token, csrfToken } = await createSession(ctx.db, staff.id, ctx.config.sessionTtlMs);
    await recordAudit(ctx.db, null, { actor: { id: staff.id }, action: 'auth.login', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
    return {
      data: { staff: publicStaff(staff.id, data), csrfToken },
      headers: { 'Set-Cookie': sessionCookie(token, ctx.config) },
    };
  });

  route('GET', '/admin/auth/session', async ctx => {
    const staff = await requireStaff(ctx);
    return { data: { staff, csrfToken: ctx.session.csrfToken } };
  });

  route('POST', '/admin/auth/logout', async ctx => {
    const staff = await requireStaff(ctx);
    await ctx.session.ref.delete();
    await recordAudit(ctx.db, null, { actor: staff, action: 'auth.logout', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
    return { status: 204, headers: { 'Set-Cookie': clearSessionCookie(ctx.config) } };
  });

  // Invited staff set their own password with the one-time token the owner shared with them.
  route('POST', '/admin/auth/accept-invite', async ctx => {
    checkOrigin(ctx.req, ctx.config);
    const input = validate(ctx.body, {
      email: credentials.email,
      token: str({ min: 20, max: 200 }),
      password: str({ min: MIN_PASSWORD_LENGTH, max: 200, trim: false }),
    });
    const limiterKey = `invite:${input.email.toLowerCase()}`;
    await accountLimiter.check(limiterKey);
    const passwordHash = await hashPassword(input.password);
    const accepted = await transaction(ctx.db, async tx => {
      const staff = await staffByEmail(ctx.db, input.email, tx);
      const data = staff?.data();
      const tokenValid = data?.status === 'invited' && data.inviteTokenHash && data.inviteExpiresAt > now() && safeEqual(sha256(input.token), data.inviteTokenHash);
      if (!tokenValid) return false;
      tx.update(staff.ref, { passwordHash, status: 'active', inviteTokenHash: null, inviteExpiresAt: null, version: data.version + 1, updatedAt: now() });
      recordAudit(ctx.db, tx, { actor: { id: staff.id }, action: 'staff.invite_accepted', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
      return true;
    });
    if (!accepted) {
      await accountLimiter.record(limiterKey);
      fail('invalid_credentials', 'This invitation is invalid or has expired. Ask the owner for a new one.');
    }
    await accountLimiter.reset(limiterKey);
    return { status: 204 };
  });
}
