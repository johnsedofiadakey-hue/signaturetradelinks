import { C, newId, now, sortKey } from './firestore.js';

/**
 * Append an audit event, inside the caller's transaction when given so it commits atomically with the change.
 * Callers pass already-sanitised state: never secrets, password hashes, tokens or assessment document contents.
 */
export function recordAudit(db, tx, { actor, action, resourceType, resourceId = null, before = null, after = null, metadata = null, requestId = null }) {
  const id = newId('aud');
  const createdAt = now();
  const ref = db.collection(C.auditEvents).doc(id);
  const event = {
    actorType: actor ? 'staff' : 'system',
    actorId: actor?.id ?? null,
    action,
    resourceType,
    resourceId,
    before,
    after,
    metadata,
    requestId,
    createdAt,
    sortKey: sortKey(createdAt, id),
  };
  return tx ? tx.create(ref, event) : ref.create(event);
}

export const auditFrom = (ctx, staff) => ({ actor: staff, requestId: ctx.requestId });
