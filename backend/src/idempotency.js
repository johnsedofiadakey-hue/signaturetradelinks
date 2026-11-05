import { fail } from './http.js';
import { C, now, sha256, transaction } from './firestore.js';

const KEY_PATTERN = /^[A-Za-z0-9_:-]{8,100}$/;

/**
 * Run a write once per Idempotency-Key. A replay with the same payload returns the stored
 * response; a replay with a different payload is rejected with 409.
 * fn(tx, key) must do all its reads before any writes, and only write through tx.
 */
export function idempotent(ctx, scope, fn) {
  const key = ctx.req.headers['idempotency-key'];
  if (!key || !KEY_PATTERN.test(key)) {
    fail('validation_failed', 'An Idempotency-Key header is required.', { fieldErrors: { 'Idempotency-Key': 'Use 8–100 letters, numbers, "-", "_" or ":".' } });
  }
  const requestHash = sha256(JSON.stringify(ctx.body ?? {}));
  const ref = ctx.db.collection(C.idempotencyKeys).doc(sha256(`${scope}\n${key}`));
  return transaction(ctx.db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const stored = existing.data();
      if (stored.requestHash !== requestHash) fail('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
      return { status: stored.responseStatus, data: JSON.parse(stored.responseBody), headers: { 'Idempotent-Replayed': 'true' } };
    }
    const result = await fn(tx, key);
    tx.create(ref, { scope, requestHash, responseStatus: result.status ?? 200, responseBody: JSON.stringify(result.data), createdAt: now() });
    return result;
  });
}
