/**
 * Database layer — node:sqlite (built into Node 22.5+), so the container needs
 * no native modules, no build toolchain and no separate database server.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ENTITIES, SETTINGS_GROUPS } from './schema.js';

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'console.db');

/** Fields that are persisted as integers. */
const NUMERIC = new Set(['number']);
const BOOLEAN = new Set(['toggle']);

/** Quote an SQL identifier (field names may collide with reserved words). */
export const qi = (id) => `"${String(id).replace(/"/g, '""')}"`;

function sqlType(field) {
  if (BOOLEAN.has(field.type)) return 'INTEGER';
  if (NUMERIC.has(field.type)) return 'INTEGER';
  return 'TEXT';
}

function columnNames(table) {
  const db = getDb();
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}

let db = null;

export function getDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/** The DDL for an entity table, derived from its declaration. */
function createEntityTable(name, entity) {
  const db = getDb();
  const cols = ['id INTEGER PRIMARY KEY AUTOINCREMENT'];
  for (const f of entity.fields) {
    if (f.key === 'password') continue;
    const parts = [`${qi(f.key)} ${sqlType(f)}`];
    if (f.required && f.type !== 'toggle') parts.push('NOT NULL');
    if (f.unique) parts.push('UNIQUE');
    cols.push(parts.join(' '));
  }
  cols.push('created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))');
  cols.push('updated_at TEXT NOT NULL DEFAULT (datetime(\'now\'))');
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${cols.join(', ')})`);

  // Non-destructive migration for fields added after first boot.
  const existing = new Set(columnNames(name));
  for (const f of entity.fields) {
    if (f.key === 'password' || existing.has(f.key)) continue;
    db.exec(`ALTER TABLE ${name} ADD COLUMN ${qi(f.key)} ${sqlType(f)}`);
  }
}

export function ensureSchema() {
  const db = getDb();

  for (const [name, entity] of Object.entries(ENTITIES)) {
    createEntityTable(name, entity);
  }

  // Application-owned columns that are not part of the editable field list.
  // SQLite cannot ADD COLUMN with UNIQUE, so token_hash gets a separate index.
  const extra = {
    extensions: ['password_hash TEXT'],
    users: ['password_hash TEXT', 'last_login TEXT'],
    api_keys: ['token_hash TEXT', 'created_by TEXT', 'revoked INTEGER DEFAULT 0'],
    time_conditions: [],
    outbound_routes: [],
    ivrs: []
  };
  for (const [table, statements] of Object.entries(extra)) {
    const existing = new Set(columnNames(table));
    for (const stmt of statements) {
      const col = stmt.split(' ')[0];
      if (!existing.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${stmt}`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT,
      ip TEXT
    );
    CREATE TABLE IF NOT EXISTS cdr (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calldate TEXT NOT NULL DEFAULT (datetime('now')),
      uniqueid TEXT,
      clid TEXT,
      src TEXT,
      dst TEXT,
      dcontext TEXT,
      channel TEXT,
      dstchannel TEXT,
      duration INTEGER DEFAULT 0,
      billsec INTEGER DEFAULT 0,
      disposition TEXT DEFAULT 'ANSWERED',
      direction TEXT DEFAULT 'internal',
      recording TEXT,
      queue TEXT,
      answered_by TEXT
    );
    CREATE TABLE IF NOT EXISTS api_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      token_name TEXT,
      method TEXT,
      path TEXT,
      status INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cdr_calldate ON cdr(calldate DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_token_hash ON api_keys(token_hash);
  `);

  seedSettings();
}

function seedSettings() {
  const db = getDb();
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const group of SETTINGS_GROUPS) {
    for (const item of group.items) {
      insert.run(item.key, item.default === undefined || item.default === null ? '' : String(item.default));
    }
  }
}

export function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSetting(key, fallback = '') {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value === null || value === undefined ? '' : String(value));
}

export function audit({ actor, action, entity, entityId, detail, ip }) {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_log (actor, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    actor || 'system',
    action,
    entity || null,
    entityId === undefined || entityId === null ? null : String(entityId),
    typeof detail === 'string' ? detail : JSON.stringify(detail ?? null),
    ip || null
  );
}

export const isEmpty = () => {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS c FROM extensions').get();
  return Number(row.c) === 0;
};

