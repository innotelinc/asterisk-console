/**
 * Asterisk Console — HTTP API + static host.
 *
 * One process serves the SPA, the JSON API and the live event stream, so the
 * container is a single moving part.
 */
import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENTITIES, NAV_GROUPS, SETTINGS_GROUPS, MODULES, SECRET_TYPES
} from './schema.js';
import {
  getDb, ensureSchema, seedDemo, getSettings, setSetting, getSetting, audit, isEmpty, qi
} from './db.js';
import {
  hashPassword, hashToken, verifyPassword, sessionFromRequest, setSessionCookies,
  clearSessionCookies, csrfOk, hasRole, throttleKey, tooManyAttempts,
  recordFailure, clearFailures, tokenFromRequest
} from './auth.js';
import {
  generateConfigs, testDialplan, hostStats, refreshAmi, getAmiState, amiConfigured, reloadMusicOnHold
} from './asterisk.js';
import {
  aiInfo, aiConfigured, buildRecording, buildJingle, transcribe, saveMedia, mediaPath, slugify,
  jingleDir, migrateJingleAudio, removeJingleAudio, removeRecordingFile, replaceClassAudio,
  saveClassAudio, ensureMusicAudio, recordingAudioPath, classAudioFile, hasReadableAudio,
  isManagedMohPath
} from './ai.js';
import { MAX_AUDIO_BYTES, toAsteriskWav } from './audio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIST = join(__dirname, '..', 'web', 'dist');

ensureSchema();
if (process.env.SEED_DEMO !== '0') seedDemo();

const SCHEMA_VERSION = '1.0.0';
const app = express();
app.disable('x-powered-by');
// Only trust X-Forwarded-* when explicitly deployed behind a proxy, otherwise
// clients could spoof their address and dodge login throttling.
app.set('trust proxy', process.env.TRUST_PROXY === '1');

app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '4mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'"
  );
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Derived from the schema so a new password field is protected automatically.
const SECRET_KEYS = new Set(
  Object.values(ENTITIES).flatMap((entity) =>
    entity.fields.filter((f) => SECRET_TYPES.has(f.type)).map((f) => f.key)
  )
);

function coerce(field, value) {
  if (value === undefined) return undefined;
  if (field.type === 'toggle') return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
  if (value === null || value === '') return null;
  if (field.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === 'json') {
    if (typeof value === 'object') return JSON.stringify(value);
    try {
      JSON.parse(value);
      return String(value);
    } catch {
      throw Object.assign(new Error(`${field.label} must be valid JSON`), { status: 400 });
    }
  }
  if (field.type === 'tags') {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(',');
    return String(value).split(/[,\n]/).map((v) => v.trim()).filter(Boolean).join(',');
  }
  if (field.type === 'relation') return String(value);
  return String(value);
}

function redact(entityName, row, session) {
  if (!row) return row;
  const out = { ...row };
  for (const f of ENTITIES[entityName].fields) {
    if (SECRET_KEYS.has(f.key) && session?.role === 'readonly') delete out[f.key];
  }
  if (entityName === 'users') delete out.password_hash;
  if (entityName === 'extensions') delete out.password_hash;
  if (entityName === 'api_keys') delete out.token_hash;
  return out;
}

function publicMeta() {
  const entities = {};
  for (const [name, entity] of Object.entries(ENTITIES)) {
    entities[name] = {
      ...entity,
      fields: entity.fields.map((f) => ({
        ...f,
        secret: SECRET_TYPES.has(f.type)
      }))
    };
  }
  return {
    app: {
      name: getSetting('pbx_name', 'Asterisk Console'),
      version: SCHEMA_VERSION,
      asteriskConfigDir: getSetting('ast_config_dir', '/etc/asterisk'),
      amiConfigured: amiConfigured(),
      seeded: !isEmpty()
    },
    nav: NAV_GROUPS,
    entities,
    settingsGroups: SETTINGS_GROUPS,
    modules: MODULES,
    destinations: destinationCatalog()
  };
}

function destinationCatalog() {
  const db = getDb();
  const pick = (table, valueCol, labelCol) =>
    db.prepare(`SELECT ${valueCol} AS value, ${labelCol} AS label FROM ${table} WHERE enabled = 1 ORDER BY ${valueCol}`).all();
  return {
    extension: pick('extensions', 'extension', 'name'),
    ring_group: pick('ring_groups', 'number', 'name'),
    queue: pick('queues', 'number', 'name'),
    ivr: pick('ivrs', 'number', 'name'),
    time_condition: pick('time_conditions', 'number', 'name'),
    announcement: pick('announcements', 'number', 'name'),
    voicemail: pick('voicemail', 'mailbox', 'name'),
    conference: pick('conferences', 'number', 'name'),
    parking: pick('parking', 'number', 'name'),
    disa: pick('disa', 'number', 'name'),
    misc: pick('misc_destinations', 'number', 'name'),
    terminate: []
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/me', '/api/auth/setup', '/api/health'];

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: SCHEMA_VERSION, needsSetup: !adminExists() });
});

function adminExists() {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get();
  return Number(row.c) > 0;
}

app.post('/api/auth/setup', (req, res) => {
  if (adminExists()) return res.status(409).json({ error: 'Setup already completed' });
  const { username, password, name, email } = req.body || {};
  if (!username || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
  }
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO users (username, name, email, role, enabled, password_hash) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(String(username), name || 'Administrator', email || null, 'admin', hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  setSessionCookies(req, res, user);
  audit({ actor: user.username, action: 'setup', entity: 'users', entityId: user.id, ip: req.ip });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const max = Number(getSetting('login_max_attempts', '8')) || 8;
  const key = throttleKey(req, username);
  if (tooManyAttempts(key, max)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!user || !user.enabled || !verifyPassword(password, user.password_hash)) {
    recordFailure(key);
    audit({ actor: username || 'unknown', action: 'login_failed', entity: 'users', ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  clearFailures(key);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  setSessionCookies(req, res, user);
  audit({ actor: user.username, action: 'login', entity: 'users', entityId: user.id, ip: req.ip });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookies(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = sessionFromRequest(req);
  if (!session) return res.json({ user: null, needsSetup: !adminExists() });
  res.json({ user: session, needsSetup: false });
});

// API tokens authenticate automation. They carry their own scope, need no CSRF
// token (nothing is cookie-bound) and are recorded in api_requests.
function apiKeyFromToken(token) {
  const row = getDb().prepare('SELECT * FROM api_keys WHERE prefix = ? AND revoked = 0').get(token.slice(0, 10));
  if (!row?.token_hash) return null;
  const presented = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(row.token_hash, 'hex');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
  return row;
}

// Everything below requires a session or an API token. Static assets and the
// SPA shell are public: they contain no data and the client redirects to login.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.includes(req.path)) return next();

  const token = tokenFromRequest(req);
  if (token) {
    const key = apiKeyFromToken(token);
    if (!key) return res.status(401).json({ error: 'Invalid or revoked API token' });
    const db = getDb();
    db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(key.id);
    res.on('finish', () => {
      db.prepare('INSERT INTO api_requests (token_name, method, path, status) VALUES (?, ?, ?, ?)')
        .run(key.name, req.method, req.originalUrl, res.statusCode);
    });
    req.session = { sub: null, username: key.name, name: key.name, role: key.role, via: 'token' };
    return next();
  }

  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });
  if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF token missing or invalid' });
  req.session = session;
  next();
});

const requireRole = (role) => (req, res, next) => {
  if (!hasRole(req.session, role)) return res.status(403).json({ error: `Requires ${role} privileges` });
  next();
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------
app.get('/api/meta', (req, res) => {
  res.json(publicMeta());
});

// ---------------------------------------------------------------------------
// Generic entity CRUD
// ---------------------------------------------------------------------------
function entityOr404(req, res) {
  const entity = ENTITIES[req.params.entity];
  if (!entity) {
    res.status(404).json({ error: `Unknown module: ${req.params.entity}` });
    return null;
  }
  return entity;
}

function listRows(name, entity, query, session) {
  const db = getDb();
  const where = [];
  const params = [];
  if (query.q) {
    const cols = entity.searchable?.length ? entity.searchable : ['name'];
    where.push(`(${cols.map((c) => `${qi(c)} LIKE ?`).join(' OR ')})`);
    for (const _ of cols) params.push(`%${query.q}%`);
  }
  const limit = Math.min(Number(query.limit) || 500, 2000);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const sql = `SELECT * FROM ${name}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${qi(entity.order || 'id')} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit, offset);
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${name}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`).get(...params).c);
  return { rows: rows.map((r) => redact(name, r, session)), total };
}

app.get('/api/entities/:entity', (req, res) => {
  const entity = entityOr404(req, res);
  if (!entity) return;
  res.json(listRows(req.params.entity, entity, req.query, req.session));
});

function prepareBody(entity, body, { creating = false } = {}) {
  const values = {};
  for (const field of entity.fields) {
    const supplied = body[field.key] !== undefined;
    if (supplied) {
      const coerced = coerce(field, body[field.key]);
      if (coerced !== undefined) values[field.key] = coerced;
    } else if (creating && field.default !== undefined && field.type !== 'password') {
      // Fall back to the declared default so a partial payload still produces
      // a complete, valid row.
      values[field.key] = coerce(field, field.default);
    }
    if (!field.required || field.type === 'toggle') continue;
    const value = values[field.key];
    const blank = value === undefined || value === null || value === '';
    // On update, omitting a field means "keep it"; supplying a blank one is an error.
    if (creating ? blank : supplied && (value === null || value === '')) {
      throw Object.assign(new Error(`${field.label} is required`), { status: 400 });
    }
  }
  return values;
}

app.post('/api/entities/:entity', requireRole('operator'), (req, res) => {
  const name = req.params.entity;
  const entity = entityOr404(req, res);
  if (!entity) return;
  if (name === 'api_keys' || name === 'users') {
    if (!hasRole(req.session, 'admin')) return res.status(403).json({ error: 'Requires admin privileges' });
  }
  const db = getDb();
  try {
    const values = prepareBody(entity, req.body || {}, { creating: true });
    // A new class must have audio on the media volume, or musiconhold.conf would
    // name a directory that holds nothing.
    if (name === 'music' && values.path) {
      values.path = ensureMusicAudio(values.path, values.name) || values.path;
    }
    if (name === 'users') {
      const pw = req.body?.password;
      if (!pw || String(pw).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      values.password_hash = hashPassword(pw);
    }
    if (name === 'extensions' && !values.secret) values.secret = randomBytes(6).toString('hex');
    delete values.password;
    const keys = Object.keys(values);
    if (keys.length === 0) return res.status(400).json({ error: 'No values supplied' });
    const info = db.prepare(
      `INSERT INTO ${name} (${keys.map(qi).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).run(...keys.map((k) => values[k]));
    const id = Number(info.lastInsertRowid);

    let extra = {};
    if (name === 'api_keys') {
      const token = `ac_${randomBytes(24).toString('base64url')}`;
      db.prepare('UPDATE api_keys SET token_hash = ?, prefix = ?, created_by = ? WHERE id = ?')
        .run(hashToken(token), token.slice(0, 10), req.session.username, id);
      extra = { token };
    }
    audit({ actor: req.session.username, action: 'create', entity: name, entityId: id, ip: req.ip, detail: values });
    const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    res.status(201).json({ row: redact(name, row, req.session), ...extra });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A record with that value already exists' });
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/entities/:entity/:id', requireRole('operator'), (req, res) => {
  const name = req.params.entity;
  const entity = entityOr404(req, res);
  if (!entity) return;
  if (name === 'api_keys' || name === 'users') {
    if (!hasRole(req.session, 'admin')) return res.status(403).json({ error: 'Requires admin privileges' });
  }
  const db = getDb();
  try {
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const values = prepareBody(entity, req.body || {});
    if (name === 'music') {
      const path = values.path ?? existing.path;
      values.path = ensureMusicAudio(path, values.name ?? existing.name) || path;
    }
    if (name === 'users' && req.body?.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      values.password_hash = hashPassword(req.body.password);
    }
    if (name === 'users' && existing.role === 'admin' && values.role && values.role !== 'admin') {
      const admins = Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND enabled = 1").get().c);
      if (admins <= 1) return res.status(400).json({ error: 'At least one enabled administrator is required' });
    }
    delete values.password;
    const keys = Object.keys(values);
    if (keys.length) {
      db.prepare(
        `UPDATE ${name} SET ${keys.map((k) => `${qi(k)} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
      ).run(...keys.map((k) => values[k]), id);
    }
    audit({ actor: req.session.username, action: 'update', entity: name, entityId: id, ip: req.ip, detail: values });
    res.json({ row: redact(name, db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id), req.session) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A record with that value already exists' });
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/entities/:entity/:id', requireRole('operator'), async (req, res) => {
  const name = req.params.entity;
  if (name === 'users' && !hasRole(req.session, 'admin')) return res.status(403).json({ error: 'Requires admin privileges' });
  if (!entityOr404(req, res)) return;
  const db = getDb();
  const id = Number(req.params.id);
  if (name === 'users' && id === req.session.sub) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (name === 'users') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND enabled = 1").get();
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (target?.role === 'admin' && Number(admins.c) <= 1) {
      return res.status(400).json({ error: 'At least one enabled administrator is required' });
    }
  }
  try {
    // Read the row first: recordings and music classes own a generated WAV that
    // has to go with them.
    const doomed = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id);
    if (name === 'recordings' && doomed) removeRecordingFile(doomed.filename);
    // Asterisk only notices the files are gone once the module re-reads the
    // directory, so report whether that reload actually happened.
    const removed = name === 'music' && doomed ? removeJingleAudio(doomed.path, doomed.name) : false;
    const reload = removed ? await reloadMusicOnHold() : null;
    audit({ actor: req.session.username, action: 'delete', entity: name, entityId: id, detail: reload ? { reloaded: reload.reloaded } : undefined, ip: req.ip });
    res.json({ ok: true, ...(reload ? { reload } : {}) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// CSV export / import -------------------------------------------------------
app.get('/api/entities/:entity/export.csv', (req, res) => {
  const name = req.params.entity;
  const entity = entityOr404(req, res);
  if (!entity) return;
  const cols = entity.fields.filter((f) => !SECRET_TYPES.has(f.type)).map((f) => f.key);
  const rows = getDb().prepare(`SELECT ${cols.map(qi).join(', ')} FROM ${name} ORDER BY ${qi(entity.order || 'id')}`).all();
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(csv);
});

app.post('/api/entities/:entity/import', requireRole('operator'), (req, res) => {
  const name = req.params.entity;
  const entity = entityOr404(req, res);
  if (!entity) return;
  const text = typeof req.body === 'string' ? req.body : String(req.body?.csv || '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'CSV needs a header row and at least one data row' });

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };

  const header = parseLine(lines[0]).map((h) => h.trim());
  const byKey = new Map(entity.fields.map((f) => [f.key, f]));
  let created = 0;
  const errors = [];
  const db = getDb();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseLine(lines[i]);
    const values = {};
    header.forEach((h, idx) => {
      const field = byKey.get(h);
      if (!field || SECRET_TYPES.has(field.type)) return;
      const raw = cells[idx];
      if (raw === undefined || raw === '') return;
      try {
        values[h] = coerce(field, raw);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    });
    try {
      const keys = Object.keys(values);
      if (!keys.length) continue;
      if (name === 'extensions') {
        const existing = db.prepare('SELECT id FROM extensions WHERE extension = ?').get(values.extension);
        if (existing) {
          db.prepare(`UPDATE extensions SET ${keys.map((k) => `${qi(k)} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
            .run(...keys.map((k) => values[k]), existing.id);
          created += 1;
          continue;
        }
        if (!values.secret) values.secret = randomBytes(6).toString('hex');
      }
      db.prepare(`INSERT INTO ${name} (${keys.map(qi).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .run(...keys.map((k) => values[k]));
      created += 1;
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }
  audit({ actor: req.session.username, action: 'import', entity: name, detail: { created, errors: errors.length }, ip: req.ip });
  res.json({ imported: created, errors });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  const values = getSettings();
  if (req.session.role === 'readonly') delete values.ami_secret;
  res.json({ values });
});

app.put('/api/settings', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const db = getDb();
  const known = new Set(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.key)));
  for (const [key, value] of Object.entries(body)) {
    if (!known.has(key)) continue;
    if (value === undefined) continue;
    setSetting(key, value);
  }
  audit({ actor: req.session.username, action: 'settings_update', entity: 'settings', detail: Object.keys(body), ip: req.ip });
  res.json({ values: getSettings() });
});

// ---------------------------------------------------------------------------
// AI audio — recordings from text or voice, music-on-hold jingles
// ---------------------------------------------------------------------------
app.get('/api/ai/status', (req, res) => {
  res.json(aiInfo());
});

app.post('/api/ai/transcribe', requireRole('operator'),
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '15mb' }),
  async (req, res, next) => {
    try {
      if (!aiConfigured()) return res.status(503).json({ error: 'AI audio is not configured: set OMNIROUTE_API_KEY' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Send the recorded audio as the raw request body' });
      }
      const format = String(req.query.format || 'wav').toLowerCase().replace(/^audio\//, '');
      const text = await transcribe(req.body, format);
      audit({ actor: req.session.username, action: 'ai_transcribe', entity: 'recordings', detail: { bytes: req.body.length }, ip: req.ip });
      res.json({ text });
    } catch (err) { next(err); }
  });

app.post('/api/ai/recordings', requireRole('operator'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const script = String(req.body?.text || '').trim();
    if (!name) return res.status(400).json({ error: 'Recording name is required' });
    if (!script) return res.status(400).json({ error: 'Script text is required' });
    const wav = await buildRecording({ text: script, voice: req.body?.voice });
    const file = saveMedia('recordings', name, wav);
    const db = getDb();
    try {
      const info = db.prepare(
        'INSERT INTO recordings (name, filename, language, description, enabled) VALUES (?, ?, ?, ?, 1)'
      ).run(
        name,
        `custom/${file.replace(/\.wav$/, '')}`,
        String(req.body?.language || 'en'),
        String(req.body?.description || `AI generated · ${script.slice(0, 90)}`)
      );
      const row = db.prepare('SELECT * FROM recordings WHERE id = ?').get(Number(info.lastInsertRowid));
      audit({ actor: req.session.username, action: 'ai_recording', entity: 'recordings', entityId: row.id, detail: { name, voice: req.body?.voice, chars: script.length }, ip: req.ip });
      res.status(201).json({ row: redact('recordings', row, req.session), file: `/api/media/recordings/${file}`, text: script });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'A recording with that name already exists' });
      }
      throw err;
    }
  } catch (err) { next(err); }
});

app.post('/api/ai/jingle', requireRole('operator'), async (req, res, next) => {
  try {
    const brief = String(req.body?.prompt || '').trim();
    if (!brief) return res.status(400).json({ error: 'Describe the jingle you want' });
    const className = slugify(req.body?.name || 'jingle');
    const { wav, tagline, seconds } = await buildJingle({ prompt: brief, voice: req.body?.voice });
    // The class points at this exact directory, so the WAV has to live in it.
    // Generating again replaces the class's own audio instead of stacking a
    // second jingle in front of the first; hand-added files are left alone.
    const directory = jingleDir(className);
    const file = replaceClassAudio(directory, className, wav);
    const db = getDb();
    let row = db.prepare('SELECT * FROM music WHERE name = ?').get(className);
    if (row) {
      db.prepare("UPDATE music SET path = ?, mode = 'files', updated_at = datetime('now') WHERE id = ?").run(directory, row.id);
    } else {
      const info = db.prepare('INSERT INTO music (name, mode, path, sort, enabled) VALUES (?, ?, ?, ?, 1)')
        .run(className, 'files', directory, 'alpha');
      row = db.prepare('SELECT * FROM music WHERE id = ?').get(Number(info.lastInsertRowid));
    }
    const reload = await reloadMusicOnHold();
    audit({ actor: req.session.username, action: 'ai_jingle', entity: 'music', entityId: row.id, detail: { className, tagline, seconds, voice: req.body?.voice, reloaded: reload.reloaded }, ip: req.ip });
    res.status(201).json({
      row: redact('music', db.prepare('SELECT * FROM music WHERE id = ?').get(row.id), req.session),
      file: `/api/media/moh/${className}/${file}`,
      tagline,
      seconds,
      directory,
      reload
    });
  } catch (err) { next(err); }
});

// Upload hold music: the request body is the file itself. Anything that is not
// already 8 kHz mono PCM WAV is converted, so a class never points at audio the
// PBX cannot play.
app.post('/api/entities/music/:id/audio', requireRole('operator'),
  express.raw({ type: ['audio/*', 'application/octet-stream', 'video/*', 'application/ogg'], limit: MAX_AUDIO_BYTES }),
  async (req, res, next) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM music WHERE id = ?').get(Number(req.params.id));
      if (!row) return res.status(404).json({ error: 'Music class not found' });
      const { wav, converted, source } = await toAsteriskWav(req.body);
      // Uploads land in the console's own store; a custom directory belongs to
      // the operator and is never written into.
      const stored = String(row.path || '');
      const directory = isManagedMohPath(stored) ? stored : jingleDir(row.name);
      // An upload means "this is the music for this class", so it replaces the
      // console's own audio by default; ?append=1 keeps the existing tracks.
      // Replacing writes the new file before removing the old ones, so the
      // class always has audio to play.
      const replace = String(req.query.append || '') !== '1';
      const file = replace
        ? replaceClassAudio(directory, row.name, wav)
        : saveClassAudio(directory, row.name, wav);
      if (directory !== row.path || row.mode !== 'files') {
        db.prepare("UPDATE music SET path = ?, mode = 'files', updated_at = datetime('now') WHERE id = ?").run(directory, row.id);
      }
      const reload = await reloadMusicOnHold();
      audit({
        actor: req.session.username, action: 'upload_audio', entity: 'music', entityId: row.id,
        detail: { file, bytes: wav.length, converted, source, replace, reloaded: reload.reloaded, upload: req.get('x-filename') || null },
        ip: req.ip
      });
      res.status(201).json({
        row: redact('music', db.prepare('SELECT * FROM music WHERE id = ?').get(row.id), req.session),
        file: `/api/media/moh/${basename(directory)}/${file}`,
        directory, bytes: wav.length, converted, source, replace, reload
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });

// Reload music-on-hold on demand: an operator who dropped a file into a class
// directory can push it live without regenerating a Jingle. reloadMusicOnHold
// always resolves with an answer, so nothing here can reject.
app.post('/api/moh/reload', requireRole('operator'), async (req, res) => {
  const reload = await reloadMusicOnHold();
  audit({ actor: req.session.username, action: 'reload_music', entity: 'music', detail: { reloaded: reload.reloaded }, ip: req.ip });
  res.json({ reload });
});

// Preview for a record's audio: recordings play their stored WAV, a music class
// plays the first file in its directory.
app.get('/api/entities/:entity/:id/audio', (req, res) => {
  const name = req.params.entity;
  if (name !== 'recordings' && name !== 'music') {
    return res.status(404).json({ error: 'This module has no audio' });
  }
  const row = getDb().prepare(`SELECT * FROM ${name} WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Record not found' });
  const file = name === 'recordings' ? recordingAudioPath(row.filename) : classAudioFile(row.path);
  if (!file) return res.status(404).json({ error: 'No audio file for this record' });
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(file);
});

function sendMedia(req, res, name) {
  const file = mediaPath(req.params.kind, name);
  if (!file || !existsSync(file)) return res.status(404).json({ error: 'Audio file not found' });
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(file);
}

// Jingles live in their music class's own directory, so the path has a segment.
app.get('/api/media/:kind/:dir/:file', (req, res) => sendMedia(req, res, `${req.params.dir}/${req.params.file}`));
app.get('/api/media/:kind/:file', (req, res) => sendMedia(req, res, req.params.file));

// ---------------------------------------------------------------------------
// Config generation + dialplan test
// ---------------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  const result = generateConfigs();
  if (req.query.write === '1') {
    const dir = getSetting('ast_config_dir', '/etc/asterisk');
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      for (const file of result.files) writeFileSync(join(dir, file.name), file.content, 'utf8');
      audit({ actor: req.session.username, action: 'config_write', entity: 'config', detail: dir, ip: req.ip });
      result.writtenTo = dir;
    } catch (err) {
      result.writeError = err.message;
    }
  }
  res.json(result);
});

app.get('/api/config/:file', (req, res) => {
  const result = generateConfigs();
  const file = result.files.find((f) => f.name === req.params.file);
  if (!file) return res.status(404).json({ error: 'Unknown config file' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(file.content);
});

app.post('/api/tools/dialplan-test', (req, res) => {
  const { number, callerId } = req.body || {};
  res.json(testDialplan(number, callerId));
});

// ---------------------------------------------------------------------------
// CDR
// ---------------------------------------------------------------------------
app.get('/api/cdr', (req, res) => {
  const db = getDb();
  const where = [];
  const params = [];
  for (const [param, column] of [['src', 'src'], ['dst', 'dst'], ['disposition', 'disposition'], ['direction', 'direction']]) {
    if (req.query[param]) { where.push(`${column} = ?`); params.push(req.query[param]); }
  }
  if (req.query.from) { where.push('calldate >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('calldate <= ?'); params.push(req.query.to); }
  if (req.query.q) {
    where.push('(src LIKE ? OR dst LIKE ? OR clid LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = db.prepare(
    `SELECT * FROM cdr ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY calldate DESC LIMIT ?`
  ).all(...params, limit);
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM cdr ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).get(...params).c);
  res.json({ rows, total });
});

app.delete('/api/cdr', requireRole('admin'), (req, res) => {
  getDb().exec('DELETE FROM cdr');
  audit({ actor: req.session.username, action: 'cdr_clear', entity: 'cdr', ip: req.ip });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
app.get('/api/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ rows });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function dashboardPayload() {
  const db = getDb();
  const count = (sql, ...p) => Number(db.prepare(sql).get(...p).c);
  const today = new Date().toISOString().slice(0, 10);
  const answered = count("SELECT COUNT(*) AS c FROM cdr WHERE disposition = 'ANSWERED' AND calldate >= ?", today);
  const totalToday = count('SELECT COUNT(*) AS c FROM cdr WHERE calldate >= ?', today);
  const missed = count("SELECT COUNT(*) AS c FROM cdr WHERE disposition IN ('NO ANSWER','BUSY','FAILED') AND calldate >= ?", today);

  const hourly = db.prepare(
    `SELECT substr(calldate, 12, 2) AS hour, COUNT(*) AS calls,
            SUM(CASE WHEN disposition='ANSWERED' THEN 1 ELSE 0 END) AS answered
     FROM cdr WHERE calldate >= datetime('now','-24 hours') GROUP BY hour ORDER BY hour`
  ).all().map((r) => ({ hour: `${r.hour}:00`, calls: Number(r.calls), answered: Number(r.answered) }));

  const trend = db.prepare(
    `SELECT substr(calldate,1,10) AS day, COUNT(*) AS calls,
            SUM(CASE WHEN disposition='ANSWERED' THEN 1 ELSE 0 END) AS answered,
            SUM(billsec) AS seconds
     FROM cdr GROUP BY day ORDER BY day DESC LIMIT 7`
  ).all().reverse().map((r) => ({ day: r.day, calls: Number(r.calls), answered: Number(r.answered), minutes: Math.round(Number(r.seconds) / 60) }));

  const dispositions = db.prepare(
    'SELECT disposition, COUNT(*) AS c FROM cdr GROUP BY disposition ORDER BY c DESC'
  ).all().map((r) => ({ label: r.disposition, value: Number(r.c) }));

  const topDestinations = db.prepare(
    'SELECT dst, COUNT(*) AS c FROM cdr GROUP BY dst ORDER BY c DESC LIMIT 6'
  ).all().map((r) => ({ label: r.dst, value: Number(r.c) }));

  return {
    kpis: {
      extensions: count('SELECT COUNT(*) AS c FROM extensions WHERE enabled = 1'),
      trunks: count('SELECT COUNT(*) AS c FROM trunks WHERE enabled = 1'),
      queues: count('SELECT COUNT(*) AS c FROM queues WHERE enabled = 1'),
      callsToday: totalToday,
      answeredToday: answered,
      missedToday: missed,
      answerRate: totalToday ? Math.round((answered / totalToday) * 100) : 0,
      avgTalkSeconds: Math.round(Number(db.prepare("SELECT AVG(billsec) AS a FROM cdr WHERE disposition='ANSWERED'").get().a || 0)),
      activeCalls: 0
    },
    hourly,
    trend,
    dispositions,
    topDestinations,
    recent: db.prepare('SELECT * FROM cdr ORDER BY calldate DESC LIMIT 8').all(),
    queues: db.prepare('SELECT * FROM queues WHERE enabled = 1 ORDER BY number').all().map((q) => ({
      number: q.number, name: q.name, strategy: q.strategy, timeout: q.timeout,
      waiting: 0, agents: String(q.agents || '').split(',').filter(Boolean).length
    })),
    system: hostStats(),
    ami: getAmiState()
  };
}

app.get('/api/dashboard', (req, res) => {
  res.json(dashboardPayload());
});

// ---------------------------------------------------------------------------
// Live event stream (SSE)
// ---------------------------------------------------------------------------
const sseClients = new Set();
const activeCalls = new Map();
let tick = 0;

function simulateCalls() {
  tick += 1;
  const db = getDb();
  const exts = db.prepare('SELECT extension, name FROM extensions WHERE enabled = 1').all();
  const queues = db.prepare('SELECT number, name FROM queues WHERE enabled = 1').all();

  // Start a call occasionally.
  if (exts.length && Math.random() < 0.35 && activeCalls.size < 6) {
    const src = exts[Math.floor(Math.random() * exts.length)];
    const dst = exts[Math.floor(Math.random() * exts.length)];
    const id = randomUUID();
    const queue = queues.length && Math.random() < 0.4 ? queues[Math.floor(Math.random() * queues.length)] : null;
    activeCalls.set(id, {
      id,
      caller: String(src.extension),
      callerName: src.name,
      callee: queue ? String(queue.number) : String(dst.extension),
      calleeName: queue ? queue.name : dst.name,
      state: queue ? 'waiting' : 'ringing',
      startedAt: Date.now(),
      direction: Math.random() < 0.3 ? 'inbound' : 'internal',
      queue: queue?.name || null
    });
  }

  // Advance states.
  for (const [id, call] of activeCalls) {
    const age = Date.now() - call.startedAt;
    if (call.state === 'ringing' && age > 4000) call.state = 'talking';
    if (call.state === 'waiting' && age > 6000) call.state = 'talking';
    if (age > 45000) {
      db.prepare(
        `INSERT INTO cdr (calldate, uniqueid, clid, src, dst, dcontext, channel, dstchannel, duration, billsec, disposition, direction, queue, answered_by)
         VALUES (datetime('now'), ?, ?, ?, ?, 'from-internal', ?, ?, ?, ?, 'ANSWERED', ?, ?, ?)`
      ).run(
        call.id,
        `"${call.callerName}" <${call.caller}>`,
        call.caller,
        call.callee,
        `PJSIP/${call.caller}-${id.slice(0, 6)}`,
        `PJSIP/${call.callee}-${id.slice(0, 6)}`,
        Math.round(age / 1000),
        Math.round(age / 1000) - 4,
        call.direction,
        call.queue,
        call.callee
      );
      activeCalls.delete(id);
    }
  }
}

function broadcast() {
  const payload = JSON.stringify({
    type: 'tick',
    at: new Date().toISOString(),
    system: hostStats(),
    ami: getAmiState(),
    calls: [...activeCalls.values()],
    counters: {
      active: activeCalls.size,
      waiting: [...activeCalls.values()].filter((c) => c.state === 'waiting').length,
      talking: [...activeCalls.values()].filter((c) => c.state === 'talking').length
    }
  });
  for (const client of sseClients) {
    try { client.write(`event: tick\ndata: ${payload}\n\n`); } catch { sseClients.delete(client); }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

setInterval(() => {
  // Only model channel activity while someone is watching, so an idle
  // container never writes call records on its own.
  if (sseClients.size) {
    simulateCalls();
    broadcast();
  }
}, 4000);

setInterval(() => { refreshAmi().catch(() => {}); }, 15000);
refreshAmi().catch(() => {});

// ---------------------------------------------------------------------------
// Static SPA
// ---------------------------------------------------------------------------
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, {
    index: 'index.html',
    setHeaders: (res, path) => {
      if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.status(503).send(
      '<!doctype html><meta charset="utf-8"><title>Asterisk Console</title>' +
      '<body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0">' +
      '<h1>Asterisk Console API is running</h1>' +
      '<p>The web interface has not been built yet. Run <code>npm run build</code>, or use the Docker image.</p></body>'
    );
  });
}

app.use((err, req, res, next) => {
  console.error('[api error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// ---------------------------------------------------------------------------
// Bootstrap administrator
// ---------------------------------------------------------------------------
// ADMIN_PASSWORD is the only source of the initial password: there is no
// default and no built-in test credential. Without it the app waits for the
// first-run setup screen instead of creating a guessable account.
function bootstrapAdmin() {
  if (adminExists()) return;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.log('No administrator yet: open the web interface for first-run setup, or set ADMIN_PASSWORD.');
    return;
  }
  if (String(password).length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters; no administrator was created.');
  }
  const username = process.env.ADMIN_USER || 'admin';
  getDb().prepare('INSERT INTO users (username, name, email, role, enabled, password_hash) VALUES (?, ?, ?, ?, 1, ?)')
    .run(username, 'Administrator', process.env.ADMIN_EMAIL || null, 'admin', hashPassword(password));
  audit({ actor: 'system', action: 'bootstrap_admin', entity: 'users', detail: username });
  console.log(`Bootstrapped administrator "${username}" from ADMIN_PASSWORD.`);
}

try {
  bootstrapAdmin();
} catch (err) {
  console.error(`[startup] ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// One-time music-on-hold media migration
// ---------------------------------------------------------------------------
// Classes generated before jingles had their own directory point at an Asterisk
// path that holds no audio, while their WAV sits flat in the media volume. Move
// it into the class directory and store that path, so musiconhold.conf points at
// files that exist and the class actually plays.
function normalizeMusicClasses() {
  const db = getDb();
  const rows = db.prepare('SELECT id, name, path FROM music').all();

  // A freshly mounted hold-music volume hides audio that used to sit in the data
  // volume. Say exactly how to copy it once rather than silently replacing it.
  const shadowed = rows.filter((row) => isManagedMohPath(row.path) && !hasReadableAudio(row.path));
  if (shadowed.length) {
    console.warn('[startup] music classes point at the media volume but it holds no audio. If you upgraded to the '
      + 'pbx-moh volume, copy the old hold music once:\n'
      + '  docker run --rm --user root -v <data-volume>:/from:ro -v <moh-volume>:/to asterisk-console '
      + "sh -c 'cp -a /from/media/moh/. /to/'");
  }

  let migrated = 0;
  let filled = 0;
  for (const row of rows) {
    let path = row.path;
    let moved = false;
    try {
      const migratedTo = migrateJingleAudio(row.path, row.name);
      moved = Boolean(migratedTo);
      path = migratedTo || path;
      path = ensureMusicAudio(path, row.name) || path;
    } catch (err) {
      console.error(`[startup] could not prepare music class "${row.name}": ${err.message}`);
      continue;
    }
    if (!isManagedMohPath(path) && !hasReadableAudio(path)) {
      console.warn(`[startup] music class "${row.name}" points at ${path || '(empty)'}, which has no readable audio; calls will hear silence.`);
    }
    if (path === row.path) continue;
    db.prepare("UPDATE music SET path = ?, updated_at = datetime('now') WHERE id = ?").run(path, row.id);
    console.log(`[startup] music class "${row.name}" now uses ${path}`);
    if (moved) migrated += 1; else filled += 1;
  }
  if (migrated || filled) {
    audit({ actor: 'system', action: 'migrate', entity: 'music', detail: { migrated, filled } });
  }
}

try {
  normalizeMusicClasses();
} catch (err) {
  console.error(`[startup] music normalization failed: ${err.message}`);
}

const server = app.listen(PORT, HOST, () => {
  const mode = adminExists() ? 'ready' : 'awaiting first-run setup';
  console.log(`Asterisk Console v${SCHEMA_VERSION} listening on http://${HOST}:${PORT} (${mode})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
