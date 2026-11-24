/**
 * Database layer — node:sqlite (built into Node 22.5+), so the container needs
 * no native modules, no build toolchain and no separate database server.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
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

/** Demo content so a fresh container is immediately usable (SEED_DEMO=1). */
export function seedDemo() {
  const db = getDb();
  if (!isEmpty()) return false;

  const ins = (table, rows) => {
    for (const row of rows) {
      const keys = Object.keys(row);
      const sql = `INSERT INTO ${table} (${keys.map(qi).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
      db.prepare(sql).run(...keys.map((k) => row[k]));
    }
  };

  const extensions = [
    { extension: 1000, name: 'Main Reception', email: 'reception@example.com', tech: 'pjsip', voicemail: 1, vm_pin: '1000', vm_email: 'reception@example.com', context: 'from-internal', codecs: 'ulaw,alaw', max_contacts: 3, recording: 'inbound', ring_time: 20, enabled: 1 },
    { extension: 1001, name: 'Ava Thompson', email: 'ava@example.com', tech: 'pjsip', voicemail: 1, vm_pin: '1001', vm_email: 'ava@example.com', context: 'from-internal', codecs: 'opus,ulaw', max_contacts: 3, recording: 'never', ring_time: 20, enabled: 1 },
    { extension: 1002, name: 'Marcus Lee', email: 'marcus@example.com', tech: 'pjsip', voicemail: 1, vm_pin: '1002', vm_email: 'marcus@example.com', context: 'from-internal', codecs: 'ulaw,alaw', max_contacts: 3, recording: 'never', ring_time: 20, enabled: 1 },
    { extension: 1003, name: 'Priya Raman', email: 'priya@example.com', tech: 'pjsip', voicemail: 1, vm_pin: '1003', vm_email: 'priya@example.com', context: 'from-internal', codecs: 'ulaw,alaw', max_contacts: 3, recording: 'always', ring_time: 20, enabled: 1 },
    { extension: 1004, name: 'Conference Room', tech: 'pjsip', voicemail: 0, context: 'from-internal', codecs: 'ulaw', max_contacts: 1, recording: 'never', ring_time: 20, enabled: 1 },
    { extension: 1005, name: 'Warehouse', tech: 'pjsip', voicemail: 1, vm_pin: '1005', context: 'from-internal', codecs: 'ulaw', max_contacts: 2, recording: 'never', ring_time: 20, enabled: 0 }
  ];
  for (const e of extensions) {
    db.prepare(
      `INSERT INTO extensions (extension, name, email, tech, secret, voicemail, vm_pin, vm_email, context, codecs, max_contacts, recording, ring_time, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      e.extension, e.name, e.email ?? null, e.tech, e.secret || randomBytes(6).toString('hex'),
      e.voicemail, e.vm_pin ?? null, e.vm_email ?? null, e.context, e.codecs,
      e.max_contacts, e.recording, e.ring_time, e.enabled
    );
  }

  ins('trunks', [
    { name: 'SIP-TRUNK-PRIMARY', tech: 'pjsip', host: 'sip.provider.example', port: 5060, username: 'acme001', secret: 'trunk-secret-1', auth: 'both', registration: 1, context: 'from-trunk', codecs: 'ulaw,alaw', enabled: 1 },
    { name: 'SIP-TRUNK-BACKUP', tech: 'pjsip', host: 'sip2.provider.example', port: 5060, username: 'acme001', secret: 'trunk-secret-2', auth: 'outbound', registration: 1, context: 'from-trunk', codecs: 'ulaw', enabled: 1 }
  ]);

  ins('dids', [
    { number: '15551234567', description: 'Main line', carrier: 'SIP-TRUNK-PRIMARY', country: 'US', enabled: 1 },
    { number: '15551234568', description: 'Sales', carrier: 'SIP-TRUNK-PRIMARY', country: 'US', enabled: 1 },
    { number: '15551234569', description: 'Support', carrier: 'SIP-TRUNK-BACKUP', country: 'US', enabled: 1 }
  ]);

  ins('inbound_routes', [
    { description: 'Main line → IVR', did: '15551234567', destination_type: 'ivr', destination: '7000', privacy: 'no', fax: 0, enabled: 1 },
    { description: 'Sales → Queue', did: '15551234568', destination_type: 'queue', destination: '6000', privacy: 'no', fax: 0, enabled: 1 },
    { description: 'Support → Ring Group', did: '15551234569', destination_type: 'ring_group', destination: '5000', privacy: 'no', fax: 0, enabled: 1 }
  ]);

  ins('outbound_routes', [
    { name: 'Emergency', patterns: '911,9911', trunks: 'SIP-TRUNK-PRIMARY,SIP-TRUNK-BACKUP', prepend: null, prefix: null, callerid: null, emergency: 1, enabled: 1 },
    { name: 'Domestic', patterns: '1NXXNXXXXXX,NXXXXXX', trunks: 'SIP-TRUNK-PRIMARY,SIP-TRUNK-BACKUP', prepend: null, prefix: null, callerid: null, emergency: 0, enabled: 1 },
    { name: 'International', patterns: '011.', trunks: 'SIP-TRUNK-BACKUP', prepend: null, prefix: null, callerid: null, emergency: 0, enabled: 1 }
  ]);

  ins('ring_groups', [
    { number: 5000, name: 'Support Team', strategy: 'ringall', ring_time: 20, members: '1001,1002,1003', cid_name: 'Support', enabled: 1 },
    { number: 5001, name: 'Front Desk', strategy: 'hunt', ring_time: 15, members: '1000,1001', cid_name: 'Reception', enabled: 1 }
  ]);

  ins('queues', [
    { number: 6000, name: 'Sales Queue', strategy: 'leastrecent', timeout: 15, retry: 5, maxlen: 30, weight: 0, joinempty: 'yes', leavewhenempty: 'no', agents: '1001,1002', music: 'default', enabled: 1 },
    { number: 6001, name: 'Support Queue', strategy: 'rrmemory', timeout: 20, retry: 5, maxlen: 50, weight: 1, joinempty: 'yes', leavewhenempty: 'no', agents: '1002,1003', music: 'default', enabled: 1 }
  ]);

  ins('ivrs', [
    {
      number: 7000,
      name: 'Main Menu',
      greeting: 'main-greeting',
      repeat_loops: 3,
      timeout: 10,
      options: JSON.stringify([
        { key: '1', type: 'queue', target: '6000' },
        { key: '2', type: 'queue', target: '6001' },
        { key: '3', type: 'extension', target: '1000' },
        { key: '0', type: 'voicemail', target: '1000' }
      ]),
      invalid_destination_type: 'extension',
      invalid_destination: '1000',
      enabled: 1
    }
  ]);

  ins('time_groups', [
    { name: 'Business Hours', ranges: JSON.stringify([{ days: 'mon-fri', start: '09:00', end: '17:00' }]), timezone: 'America/New_York' },
    { name: 'Holidays', ranges: JSON.stringify([{ days: 'dec-24,dec-25,jan-01', start: '00:00', end: '23:59' }]), timezone: 'America/New_York' }
  ]);

  ins('time_conditions', [
    { number: 8000, name: 'Business Hours Check', time_group: 1, match_type: 'all', true_destination_type: 'ivr', true_destination: '7000', false_destination_type: 'announcement', false_destination: '9000', enabled: 1 }
  ]);

  ins('announcements', [
    { number: 9000, name: 'Closed Message', recording: 'closed-for-business', return_after: 0, enabled: 1 }
  ]);

  ins('conferences', [
    { number: 9500, name: 'All Hands', pin: '1950', admin_pin: '9950', max_members: 50, wait_for_leader: 0, mute_on_join: 1, enabled: 1 }
  ]);

  ins('paging', [
    { number: 9600, name: 'All-Warehouse Page', members: '1005,1002', duplex: 0, enabled: 1 }
  ]);

  const vm = [
    { mailbox: 1000, name: 'Main Reception', pin: '1000', email: 'reception@example.com', context: 'default', attach: 1, delete_after_email: 0, max_messages: 100, enabled: 1 },
    { mailbox: 1001, name: 'Ava Thompson', pin: '1001', email: 'ava@example.com', context: 'default', attach: 1, delete_after_email: 0, max_messages: 100, enabled: 1 },
    { mailbox: 1002, name: 'Marcus Lee', pin: '1002', email: 'marcus@example.com', context: 'default', attach: 1, delete_after_email: 1, max_messages: 50, enabled: 1 },
    { mailbox: 1005, name: 'Warehouse', pin: '1005', context: 'default', attach: 0, delete_after_email: 0, max_messages: 25, enabled: 1 }
  ];
  ins('voicemail', vm);

  ins('parking', [{ name: 'Default Lot', number: 70, slots: 8, timeout: 45, enabled: 1 }]);
  ins('disa', [{ number: 9700, name: 'Remote Office', pin: '4821', context: 'from-internal', callerid: 'Remote Office', enabled: 1 }]);
  ins('misc_destinations', [{ number: 9800, name: 'After-hours Auto Attendant', context: 'from-internal', extension: 's', description: 'Used by the night service toggle', enabled: 1 }]);

  ins('feature_codes', [
    { feature: 'call_parking', code: '*70', description: 'Park a call', enabled: 1 },
    { feature: 'pickup', code: '*8', description: 'Pick up a ringing call', enabled: 1 },
    { feature: 'blind_transfer', code: '#', description: 'Blind transfer', enabled: 1 },
    { feature: 'attended_transfer', code: '*2', description: 'Attended transfer', enabled: 1 },
    { feature: 'voicemail', code: '*97', description: 'Check voicemail', enabled: 1 },
    { feature: 'disconnect', code: '**', description: 'Disconnect caller', enabled: 1 }
  ]);

  ins('blacklist', [
    { number: '18005550199', description: 'Known telemarketer', enabled: 1 },
    { number: '19005550111', description: 'Repeated spam', enabled: 1 }
  ]);
  ins('allowlist', [{ number: '15559998888', description: 'Executive line', enabled: 1 }]);

  ins('contacts', [
    { first_name: 'Dana', last_name: 'Whitfield', company: 'Northwind Supply', number: '15558675309', email: 'dana@northwind.example', type: 'vendor', notes: 'Preferred hardware vendor' },
    { first_name: 'Sam', last_name: 'Okafor', company: 'City Utilities', number: '15558675310', email: 'sam@utilities.example', type: 'external' },
    { first_name: 'Iris', last_name: 'Chen', company: 'Acme Legal', number: '15558675311', type: 'vendor' }
  ]);

  ins('music', [
    { name: 'default', mode: 'files', path: '/var/lib/asterisk/moh', sort: 'alpha', enabled: 1 },
    { name: 'jazz', mode: 'files', path: '/var/lib/asterisk/moh/jazz', sort: 'alpha', enabled: 1 }
  ]);

  ins('recordings', [
    { name: 'main-greeting', filename: 'custom/main-greeting', language: 'en', description: 'Played by the main IVR', enabled: 1 },
    { name: 'closed-for-business', filename: 'custom/closed', language: 'en', description: 'After-hours message', enabled: 1 }
  ]);

  ins('dahdi', [{ channel: 1, signalling: 'fxo_ks', context: 'from-pstn', group: 0, description: 'PSTN line 1', enabled: 1 }]);
  ins('sms', [{ number: '15551234567', destination: '1000', trunk: 'SIP-TRUNK-PRIMARY', email_forward: 1, enabled: 1 }]);

  // Recent call records for the dashboard and CDR views.
  const dispositions = ['ANSWERED', 'ANSWERED', 'ANSWERED', 'NO ANSWER', 'BUSY', 'ANSWERED', 'FAILED'];
  const srcs = ['1001', '1002', '1003', '15558675309', '15551230001', '1000'];
  const dsts = ['1000', '6000', '5000', '7000', '15558675310', '9600', '18005550199'];
  const now = Date.now();
  for (let i = 0; i < 140; i += 1) {
    const start = new Date(now - Math.floor(Math.random() * 7 * 24 * 3600 * 1000) - i * 60000);
    const dur = 10 + Math.floor(Math.random() * 600);
    const disp = dispositions[Math.floor(Math.random() * dispositions.length)];
    const bill = disp === 'ANSWERED' ? Math.max(1, dur - Math.floor(Math.random() * 8)) : 0;
    const dst = dsts[Math.floor(Math.random() * dsts.length)];
    db.prepare(
      `INSERT INTO cdr (calldate, uniqueid, clid, src, dst, dcontext, channel, dstchannel, duration, billsec, disposition, direction, queue, answered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      start.toISOString().slice(0, 19).replace('T', ' '),
      randomUUID(),
      `"Caller" <${srcs[Math.floor(Math.random() * srcs.length)]}>`,
      srcs[Math.floor(Math.random() * srcs.length)],
      dst,
      'from-internal',
      `PJSIP/1001-${randomBytes(3).toString('hex')}`,
      `PJSIP/${dst}-${randomBytes(3).toString('hex')}`,
      dur,
      bill,
      disp,
      String(dst).length > 6 ? 'inbound' : 'internal',
      dst === '6000' || dst === '6001' ? 'Sales Queue' : null,
      bill > 0 ? dst : null
    );
  }

  audit({ actor: 'system', action: 'seed', entity: 'system', detail: 'Loaded demo configuration' });
  return true;
}
