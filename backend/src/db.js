import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Append-only: never edit a released migration, add a new one.
const MIGRATIONS = [
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tagline TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id),
    brand TEXT,
    specifications TEXT NOT NULL DEFAULT '[]',
    images TEXT NOT NULL DEFAULT '[]',
    illustration TEXT,
    publish_status TEXT NOT NULL DEFAULT 'draft' CHECK (publish_status IN ('draft', 'published', 'archived')),
    hire_purchase_enabled INTEGER NOT NULL DEFAULT 0 CHECK (hire_purchase_enabled IN (0, 1)),
    illustrative INTEGER NOT NULL DEFAULT 0 CHECK (illustrative IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX products_status_title ON products (publish_status, title COLLATE NOCASE, id);
  CREATE INDEX products_category ON products (category_id);

  CREATE TABLE variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    sku TEXT NOT NULL UNIQUE,
    attributes TEXT NOT NULL DEFAULT '{}',
    retail_price_minor INTEGER CHECK (retail_price_minor IS NULL OR retail_price_minor >= 0),
    currency TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((retail_price_minor IS NULL) = (currency IS NULL))
  );
  CREATE INDEX variants_product ON variants (product_id);

  -- Stock is derived from this ledger; rows are never updated or deleted.
  CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL REFERENCES variants(sku),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),
    reason TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_key TEXT NOT NULL UNIQUE,
    note TEXT,
    actor_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX inventory_movements_sku ON inventory_movements (sku, created_at, id);
  CREATE TRIGGER inventory_movements_immutable_update BEFORE UPDATE ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'inventory movements are immutable'); END;
  CREATE TRIGGER inventory_movements_immutable_delete BEFORE DELETE ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'inventory movements are immutable'); END;

  -- Used by retail checkout (milestone 3). Active, unexpired reservations reduce available stock.
  CREATE TABLE reservations (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL REFERENCES variants(sku),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    source_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'released', 'converted')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX reservations_sku_active ON reservations (sku, status, expires_at);

  CREATE TABLE staff (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'deactivated')),
    invite_token_hash TEXT,
    invite_expires_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE staff_roles (
    staff_id TEXT NOT NULL REFERENCES staff(id),
    role TEXT NOT NULL,
    PRIMARY KEY (staff_id, role)
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL REFERENCES staff(id),
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_staff ON sessions (staff_id);

  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'customer', 'system')),
    actor_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    before_state TEXT,
    after_state TEXT,
    metadata TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_events_created ON audit_events (created_at DESC, id DESC);
  CREATE INDEX audit_events_resource ON audit_events (resource_type, resource_id);
  CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;
  CREATE TRIGGER audit_events_immutable_delete BEFORE DELETE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;

  CREATE TABLE idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  `,
];

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  for (let version = applied + 1; version <= MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version - 1]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now());
    });
  }
}

/** Run fn inside a write transaction. BEGIN IMMEDIATE takes the write lock up front so reads inside are consistent. */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const now = () => new Date().toISOString();

export const newId = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;

export const json = text => (text == null ? null : JSON.parse(text));
