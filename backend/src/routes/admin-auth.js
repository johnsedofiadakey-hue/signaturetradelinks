import { recordAudit } from '../audit.js';
import {
  MIN_PASSWORD_LENGTH, RateLimiter, burnPasswordCheck, checkOrigin, clearSessionCookie, createSession, hashPassword,
  requireStaff, rolesFor, safeEqual, sessionCookie, sha256, verifyPassword,
} from '../auth.js';
import { now, transaction } from '../db.js';
import { fail } from '../http.js';
import { EMAIL, str, validate } from '../validate.js';
import { permissionsFor } from '../../../shared/contract.js';

const credentials = {
  email: str({ max: 254, pattern: EMAIL, patternMessage: 'Enter a valid email address.' }),
  password: str({ min: 1, max: 200, trim: false }),
};

export function registerAdminAuth(route, { loginLimiter = new RateLimiter({ limit: 5, windowMs: 15 * 60_000 }) } = {}) {
  const ipLimiter = new RateLimiter({ limit: 30, windowMs: 15 * 60_000 });

  route('POST', '/admin/auth/login', async ctx => {
    checkOrigin(ctx.req, ctx.config);
    const { email, password } = validate(ctx.body, credentials);
    const accountKey = `${ctx.ip}|${email.toLowerCase()}`;
    loginLimiter.check(accountKey);
    ipLimiter.check(ctx.ip);

    const staff = ctx.db.prepare("SELECT * FROM staff WHERE email = ? AND status = 'active'").get(email);
    const valid = staff?.password_hash ? await verifyPassword(password, staff.password_hash) : (await burnPasswordCheck(password), false);
    if (!valid) {
      loginLimiter.record(accountKey);
      ipLimiter.record(ctx.ip);
      if (staff) recordAudit(ctx.db, { actor: null, action: 'auth.login_failed', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
      fail('invalid_credentials', 'Email or password is incorrect.');
    }
    loginLimiter.reset(accountKey);
    const { token, csrfToken } = createSession(ctx.db, staff.id, ctx.config.sessionTtlMs);
    recordAudit(ctx.db, { actor: { id: staff.id }, action: 'auth.login', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
    const roles = rolesFor(ctx.db, staff.id);
    return {
      data: { staff: { id: staff.id, email: staff.email, displayName: staff.display_name, roles, permissions: permissionsFor(roles) }, csrfToken },
      headers: { 'Set-Cookie': sessionCookie(token, ctx.config) },
    };
  });

  route('GET', '/admin/auth/session', ctx => {
    const staff = requireStaff(ctx);
    return { data: { staff, csrfToken: ctx.session.csrfToken } };
  });

  route('POST', '/admin/auth/logout', ctx => {
    const staff = requireStaff(ctx);
    ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.session.tokenHash);
    recordAudit(ctx.db, { actor: staff, action: 'auth.logout', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
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
    const limiterKey = `${ctx.ip}|invite|${input.email.toLowerCase()}`;
    loginLimiter.check(limiterKey);
    const staff = ctx.db.prepare("SELECT * FROM staff WHERE email = ? AND status = 'invited'").get(input.email);
    const tokenValid = staff?.invite_token_hash && staff.invite_expires_at > now() && safeEqual(sha256(input.token), staff.invite_token_hash);
    if (!tokenValid) {
      loginLimiter.record(limiterKey);
      fail('invalid_credentials', 'This invitation is invalid or has expired. Ask the owner for a new one.');
    }
    const passwordHash = await hashPassword(input.password);
    transaction(ctx.db, () => {
      const result = ctx.db.prepare(`
        UPDATE staff SET password_hash = ?, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND status = 'invited'`).run(passwordHash, now(), staff.id, staff.version);
      if (result.changes === 0) fail('conflict', 'This invitation was already used.');
      recordAudit(ctx.db, { actor: { id: staff.id }, action: 'staff.invite_accepted', resourceType: 'staff', resourceId: staff.id, requestId: ctx.requestId });
    });
    loginLimiter.reset(limiterKey);
    return { status: 204 };
  });
}
