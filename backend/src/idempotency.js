import { fail } from './http.js';
import { now, transaction } from './db.js';
import { sha256 } from './auth.js';

const KEY_PATTERN = /^[A-Za-z0-9_:-]{8,100}$/;

/**
 * Run a write once per Idempotency-Key. A replay with the same payload returns the stored
 * response; a replay with a different payload is rejected with 409.
 */
export function idempotent(ctx, scope, fn) {
  const key = ctx.req.headers['idempotency-key'];
  if (!key || !KEY_PATTERN.test(key)) {
    fail('validation_failed', 'An Idempotency-Key header is required.', { fieldErrors: { 'Idempotency-Key': 'Use 8–100 letters, numbers, "-", "_" or ":".' } });
  }
  const requestHash = sha256(JSON.stringify(ctx.body ?? {}));
  return transaction(ctx.db, () => {
    const existing = ctx.db.prepare('SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = ? AND key = ?').get(scope, key);
    if (existing) {
      if (existing.request_hash !== requestHash) fail('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
      return { status: existing.response_status, data: JSON.parse(existing.response_body), headers: { 'Idempotent-Replayed': 'true' } };
    }
    const result = fn(key);
    ctx.db.prepare('INSERT INTO idempotency_keys (scope, key, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scope, key, requestHash, result.status ?? 200, JSON.stringify(result.data), now());
    return result;
  });
}
