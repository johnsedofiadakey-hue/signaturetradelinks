import { newId, now } from './db.js';

/**
 * Append an audit event. Callers pass already-sanitised state: never secrets, password hashes,
 * tokens or assessment document contents.
 */
export function recordAudit(db, { actor, action, resourceType, resourceId = null, before = null, after = null, metadata = null, requestId = null }) {
  db.prepare(`
    INSERT INTO audit_events (id, actor_type, actor_id, action, resource_type, resource_id, before_state, after_state, metadata, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId('aud'),
    actor ? 'staff' : 'system',
    actor?.id ?? null,
    action,
    resourceType,
    resourceId,
    before && JSON.stringify(before),
    after && JSON.stringify(after),
    metadata && JSON.stringify(metadata),
    requestId,
    now(),
  );
}

export const auditFrom = (ctx, staff) => ({ actor: staff, requestId: ctx.requestId });
