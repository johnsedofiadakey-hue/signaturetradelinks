import { STAFF_ROLES } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { hashPassword, randomToken, requireStaff, rolesFor, sha256 } from '../auth.js';
import { newId, now, transaction } from '../db.js';
import { fail } from '../http.js';
import { EMAIL, arrayOf, int, oneOf, str, validate } from '../validate.js';

const INVITE_TTL_MS = 72 * 60 * 60_000;
const roles = arrayOf(oneOf(STAFF_ROLES), { max: STAFF_ROLES.length });

const staffDto = (db, row) => ({
  id: row.id, email: row.email, displayName: row.display_name, status: row.status, roles: rolesFor(db, row.id),
  inviteExpiresAt: row.invite_expires_at, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
});

function activeOwnerCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM staff s JOIN staff_roles r ON r.staff_id = s.id WHERE r.role = 'owner' AND s.status = 'active'").get().n;
}

function setRoles(db, staffId, list) {
  db.prepare('DELETE FROM staff_roles WHERE staff_id = ?').run(staffId);
  const insert = db.prepare('INSERT INTO staff_roles (staff_id, role) VALUES (?, ?)');
  for (const role of new Set(list)) insert.run(staffId, role);
}

/** Trusted server-side owner bootstrap. Refuses once any owner exists; there is no public self-registration. */
export async function bootstrapOwner(db, { email, displayName, password }) {
  const passwordHash = await hashPassword(password);
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM staff_roles WHERE role = 'owner'").get()) throw new Error('An owner already exists. Use the admin portal to invite staff.');
    const id = newId('stf');
    const at = now();
    db.prepare("INSERT INTO staff (id, email, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
      .run(id, email, displayName, passwordHash, at, at);
    setRoles(db, id, ['owner']);
    recordAudit(db, { actor: null, action: 'staff.owner_bootstrapped', resourceType: 'staff', resourceId: id, after: { email, roles: ['owner'] } });
    return id;
  });
}

export function registerAdminStaff(route) {
  route('GET', '/admin/staff', ctx => {
    requireStaff(ctx, 'staff:manage');
    return { data: ctx.db.prepare('SELECT * FROM staff ORDER BY created_at, id').all().map(row => staffDto(ctx.db, row)) };
  });

  // The owner shares the one-time token out of band. No messages are sent by this system.
  route('POST', '/admin/staff', ctx => {
    const actor = requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, {
      email: str({ max: 254, pattern: EMAIL, patternMessage: 'Enter a valid email address.' }),
      displayName: str({ max: 80 }),
      roles,
    });
    if (!input.roles.length) fail('validation_failed', 'Some details need attention.', { fieldErrors: { roles: 'Choose at least one role.' } });
    const token = randomToken();
    return transaction(ctx.db, () => {
      if (ctx.db.prepare('SELECT 1 FROM staff WHERE email = ?').get(input.email)) {
        fail('conflict', 'That email already has a staff account.', { fieldErrors: { email: 'Already in use.' } });
      }
      const id = newId('stf');
      const at = now();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      ctx.db.prepare(`
        INSERT INTO staff (id, email, display_name, status, invite_token_hash, invite_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, 'invited', ?, ?, ?, ?)`).run(id, input.email, input.displayName, sha256(token), expiresAt, at, at);
      setRoles(ctx.db, id, input.roles);
      const created = staffDto(ctx.db, ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
      recordAudit(ctx.db, { ...auditFrom(ctx, actor), action: 'staff.invited', resourceType: 'staff', resourceId: id, after: { email: created.email, roles: created.roles } });
      return { status: 201, data: { staff: created, inviteToken: token, inviteExpiresAt: expiresAt } };
    });
  });

  route('PUT', '/admin/staff/:id/roles', ctx => {
    const actor = requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { roles, expectedVersion: int({ min: 1 }) });
    if (!input.roles.length) fail('validation_failed', 'Some details need attention.', { fieldErrors: { roles: 'Choose at least one role. Deactivate the account instead to remove access.' } });
    return transaction(ctx.db, () => {
      const target = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(ctx.params.id);
      if (!target) fail('not_found', 'Staff member not found.');
      const before = rolesFor(ctx.db, target.id);
      const result = ctx.db.prepare('UPDATE staff SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(now(), target.id, input.expectedVersion);
      if (result.changes === 0) fail('stale_version', 'This staff member was changed by someone else. Reload and try again.');
      setRoles(ctx.db, target.id, input.roles);
      if (activeOwnerCount(ctx.db) === 0) fail('last_owner', 'At least one active owner is required.');
      // Role changes take effect immediately: end the target's sessions so stale permissions cannot linger.
      if (target.id !== actor.id) ctx.db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(target.id);
      recordAudit(ctx.db, { ...auditFrom(ctx, actor), action: 'staff.roles_changed', resourceType: 'staff', resourceId: target.id, before: { roles: before }, after: { roles: [...new Set(input.roles)].sort() } });
      return { data: staffDto(ctx.db, ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(target.id)) };
    });
  });

  route('POST', '/admin/staff/:id/deactivate', ctx => {
    const actor = requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }), reason: str({ min: 3, max: 500 }) });
    if (ctx.params.id === actor.id) fail('conflict', 'You cannot deactivate your own account.');
    return transaction(ctx.db, () => {
      const target = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(ctx.params.id);
      if (!target) fail('not_found', 'Staff member not found.');
      if (target.status === 'deactivated') fail('invalid_transition', 'This account is already deactivated.');
      const result = ctx.db.prepare(`
        UPDATE staff SET status = 'deactivated', invite_token_hash = NULL, invite_expires_at = NULL, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`).run(now(), target.id, input.expectedVersion);
      if (result.changes === 0) fail('stale_version', 'This staff member was changed by someone else. Reload and try again.');
      if (activeOwnerCount(ctx.db) === 0) fail('last_owner', 'At least one active owner is required.');
      ctx.db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(target.id);
      recordAudit(ctx.db, {
        ...auditFrom(ctx, actor), action: 'staff.deactivated', resourceType: 'staff', resourceId: target.id,
        before: { status: target.status }, after: { status: 'deactivated' }, metadata: { reason: input.reason },
      });
      return { data: staffDto(ctx.db, ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(target.id)) };
    });
  });

  // Reissue an invitation for an invited account whose token was lost or expired.
  route('POST', '/admin/staff/:id/invite', ctx => {
    const actor = requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }) });
    const token = randomToken();
    return transaction(ctx.db, () => {
      const target = ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(ctx.params.id);
      if (!target) fail('not_found', 'Staff member not found.');
      if (target.status !== 'invited') fail('invalid_transition', 'Only invited accounts can receive a new invitation.');
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const result = ctx.db.prepare('UPDATE staff SET invite_token_hash = ?, invite_expires_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(sha256(token), expiresAt, now(), target.id, input.expectedVersion);
      if (result.changes === 0) fail('stale_version', 'This staff member was changed by someone else. Reload and try again.');
      recordAudit(ctx.db, { ...auditFrom(ctx, actor), action: 'staff.invite_reissued', resourceType: 'staff', resourceId: target.id });
      return { data: { staff: staffDto(ctx.db, ctx.db.prepare('SELECT * FROM staff WHERE id = ?').get(target.id)), inviteToken: token, inviteExpiresAt: expiresAt } };
    });
  });
}
