import { STAFF_ROLES } from '../../../shared/contract.js';
import { auditFrom, recordAudit } from '../audit.js';
import { hashPassword, randomToken, requireStaff, revokeSessions, sha256 } from '../auth.js';
import { C, newId, now, transaction } from '../firestore.js';
import { fail } from '../http.js';
import { EMAIL, arrayOf, int, oneOf, str, validate } from '../validate.js';

const INVITE_TTL_MS = 72 * 60 * 60_000;
const roles = arrayOf(oneOf(STAFF_ROLES), { max: STAFF_ROLES.length });

const staffDto = (id, d) => ({
  id, email: d.email, displayName: d.displayName, status: d.status, roles: [...d.roles].sort(),
  inviteExpiresAt: d.inviteExpiresAt ?? null, version: d.version, createdAt: d.createdAt, updatedAt: d.updatedAt,
});

const emailRef = (db, email) => db.collection(C.staffEmails).doc(sha256(email.toLowerCase()));

/** Owners that would remain active if `staffId` had `next` data. Reads inside the transaction. */
async function activeOwnersAfter(db, tx, staffId, next) {
  const owners = await tx.get(db.collection(C.staff).where('roles', 'array-contains', 'owner'));
  const remaining = owners.docs.filter(doc => doc.id !== staffId && doc.data().status === 'active').length;
  return remaining + (next.status === 'active' && next.roles.includes('owner') ? 1 : 0);
}

const staleUnless = matched => {
  if (!matched) fail('stale_version', 'This staff member was changed by someone else. Reload and try again.');
};

/** Trusted server-side owner bootstrap. Refuses once any owner exists; there is no public self-registration. */
export async function bootstrapOwner(db, { email, displayName, password }) {
  const passwordHash = await hashPassword(password);
  const id = newId('stf');
  return transaction(db, async tx => {
    const owners = await tx.get(db.collection(C.staff).where('roles', 'array-contains', 'owner').limit(1));
    if (!owners.empty) throw new Error('An owner already exists. Use the admin portal to invite staff.');
    const index = emailRef(db, email);
    if ((await tx.get(index)).exists) throw new Error('That email already has a staff account.');
    const at = now();
    tx.create(index, { staffId: id });
    tx.create(db.collection(C.staff).doc(id), {
      email, displayName, passwordHash, status: 'active', roles: ['owner'], inviteTokenHash: null, inviteExpiresAt: null, version: 1, createdAt: at, updatedAt: at,
    });
    recordAudit(db, tx, { actor: null, action: 'staff.owner_bootstrapped', resourceType: 'staff', resourceId: id, after: { email, roles: ['owner'] } });
    return id;
  });
}

export function registerAdminStaff(route) {
  route('GET', '/admin/staff', async ctx => {
    await requireStaff(ctx, 'staff:manage');
    const snap = await ctx.db.collection(C.staff).get();
    return { data: snap.docs.map(doc => staffDto(doc.id, doc.data())).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) };
  });

  // The owner shares the one-time token out of band. No messages are sent by this system.
  route('POST', '/admin/staff', async ctx => {
    const actor = await requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, {
      email: str({ max: 254, pattern: EMAIL, patternMessage: 'Enter a valid email address.' }),
      displayName: str({ max: 80 }),
      roles,
    });
    if (!input.roles.length) fail('validation_failed', 'Some details need attention.', { fieldErrors: { roles: 'Choose at least one role.' } });
    const token = randomToken();
    const id = newId('stf');
    const at = now();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const staff = {
      email: input.email, displayName: input.displayName, passwordHash: null, status: 'invited', roles: [...new Set(input.roles)],
      inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, version: 1, createdAt: at, updatedAt: at,
    };
    await transaction(ctx.db, async tx => {
      const index = emailRef(ctx.db, input.email);
      if ((await tx.get(index)).exists) fail('conflict', 'That email already has a staff account.', { fieldErrors: { email: 'Already in use.' } });
      tx.create(index, { staffId: id });
      tx.create(ctx.db.collection(C.staff).doc(id), staff);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, actor), action: 'staff.invited', resourceType: 'staff', resourceId: id, after: { email: staff.email, roles: staff.roles } });
    });
    return { status: 201, data: { staff: staffDto(id, staff), inviteToken: token, inviteExpiresAt: expiresAt } };
  });

  route('PUT', '/admin/staff/:id/roles', async ctx => {
    const actor = await requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { roles, expectedVersion: int({ min: 1 }) });
    if (!input.roles.length) fail('validation_failed', 'Some details need attention.', { fieldErrors: { roles: 'Choose at least one role. Deactivate the account instead to remove access.' } });
    const updated = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.staff).doc(ctx.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not_found', 'Staff member not found.');
      const before = snap.data();
      const next = { ...before, roles: [...new Set(input.roles)], version: before.version + 1, updatedAt: now() };
      if ((await activeOwnersAfter(ctx.db, tx, ref.id, next)) === 0) fail('last_owner', 'At least one active owner is required.');
      // Role changes take effect immediately: end the target's sessions so stale permissions cannot linger.
      const revoke = ref.id !== actor.id ? await revokeSessions(ctx.db, tx, ref.id) : () => {};
      staleUnless(before.version === input.expectedVersion);
      tx.set(ref, next);
      revoke();
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, actor), action: 'staff.roles_changed', resourceType: 'staff', resourceId: ref.id, before: { roles: [...before.roles].sort() }, after: { roles: [...next.roles].sort() } });
      return staffDto(ref.id, next);
    });
    return { data: updated };
  });

  route('POST', '/admin/staff/:id/deactivate', async ctx => {
    const actor = await requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }), reason: str({ min: 3, max: 500 }) });
    if (ctx.params.id === actor.id) fail('conflict', 'You cannot deactivate your own account.');
    const updated = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.staff).doc(ctx.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not_found', 'Staff member not found.');
      const before = snap.data();
      if (before.status === 'deactivated') fail('invalid_transition', 'This account is already deactivated.');
      const next = { ...before, status: 'deactivated', inviteTokenHash: null, inviteExpiresAt: null, version: before.version + 1, updatedAt: now() };
      if ((await activeOwnersAfter(ctx.db, tx, ref.id, next)) === 0) fail('last_owner', 'At least one active owner is required.');
      const revoke = await revokeSessions(ctx.db, tx, ref.id);
      staleUnless(before.version === input.expectedVersion);
      tx.set(ref, next);
      revoke();
      recordAudit(ctx.db, tx, {
        ...auditFrom(ctx, actor), action: 'staff.deactivated', resourceType: 'staff', resourceId: ref.id,
        before: { status: before.status }, after: { status: 'deactivated' }, metadata: { reason: input.reason },
      });
      return staffDto(ref.id, next);
    });
    return { data: updated };
  });

  // Reissue an invitation for an invited account whose token was lost or expired.
  route('POST', '/admin/staff/:id/invite', async ctx => {
    const actor = await requireStaff(ctx, 'staff:manage');
    const input = validate(ctx.body, { expectedVersion: int({ min: 1 }) });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const updated = await transaction(ctx.db, async tx => {
      const ref = ctx.db.collection(C.staff).doc(ctx.params.id);
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not_found', 'Staff member not found.');
      const before = snap.data();
      if (before.status !== 'invited') fail('invalid_transition', 'Only invited accounts can receive a new invitation.');
      staleUnless(before.version === input.expectedVersion);
      const next = { ...before, inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, version: before.version + 1, updatedAt: now() };
      tx.set(ref, next);
      recordAudit(ctx.db, tx, { ...auditFrom(ctx, actor), action: 'staff.invite_reissued', resourceType: 'staff', resourceId: ref.id });
      return staffDto(ref.id, next);
    });
    return { data: { staff: updated, inviteToken: token, inviteExpiresAt: expiresAt } };
  });
}
