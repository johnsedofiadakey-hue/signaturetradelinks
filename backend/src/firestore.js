import { initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID, createHash } from 'node:crypto';

// Collection names. Firestore security rules deny all client access; only this server (Admin SDK) reads and writes.
export const C = Object.freeze({
  categories: 'categories',
  categorySlugs: 'categorySlugs',
  products: 'products',
  productSlugs: 'productSlugs',
  variants: 'variants',
  skus: 'skus', // one doc per SKU: uniqueness plus derived stock counters, updated with each ledger entry
  inventoryMovements: 'inventoryMovements', // append-only: created, never updated or deleted
  staff: 'staff',
  staffEmails: 'staffEmails',
  sessions: 'sessions',
  auditEvents: 'auditEvents', // append-only
  idempotencyKeys: 'idempotencyKeys',
  rateLimits: 'rateLimits',
  settings: 'settings',
  orders: 'orders', // doc id is the customer-facing reference
  payments: 'payments', // verified provider payments, one per order reference
});

/**
 * Open Firestore for a project. Uses the emulator when FIRESTORE_EMULATOR_HOST is set.
 * Each project gets its own named app so tests can isolate data by project ID.
 */
export function openFirestore(projectId) {
  const name = `stl:${projectId ?? 'default'}`;
  let app;
  try {
    app = getApp(name);
    return getFirestore(app);
  } catch {
    app = initializeApp(projectId ? { projectId } : {}, name);
  }
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

export const now = () => new Date().toISOString();

export const newId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;

export const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Sortable unique key for newest-first keyset pagination. */
export const sortKey = (createdAt, id) => `${createdAt}|${id}`;

/** Run fn in a Firestore transaction. Firestore retries on contention; all reads must happen before writes. */
export const transaction = (db, fn) => db.runTransaction(fn, { maxAttempts: 10 });

/** Read a doc or query, inside a transaction when one is given. */
export const read = (target, tx) => (tx ? tx.get(target) : target.get());

export async function readAll(db, refs, tx) {
  if (!refs.length) return [];
  return tx ? tx.getAll(...refs) : db.getAll(...refs);
}
