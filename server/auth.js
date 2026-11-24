/**
 * Authentication — scrypt password hashing, stateless HMAC-signed session
 * cookies, and a double-submit CSRF token. No external crypto dependency.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ac_session';
const CSRF_COOKIE = 'ac_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function secret() {
  if (!process.env.SESSION_SECRET) {
    // Deterministic per-process fallback keeps local dev frictionless while
    // still refusing to accept cookies minted by another instance.
    process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  }
  return process.env.SESSION_SECRET;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * API tokens are 192 bits of randomness, so a fast digest is enough — scrypt
 * would only add latency to every token-authenticated request.
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function createSession(user) {
  const payload = b64({
    sub: user.id,
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'operator',
    exp: Date.now() + SESSION_TTL_MS
  });
  return `${payload}.${sign(payload)}`;
}

export function readSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function isHttps(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

export function setSessionCookies(req, res, user) {
  const secure = isHttps(req);
  const csrf = randomBytes(18).toString('base64url');
  const base = ['Path=/', 'SameSite=Lax', secure ? 'Secure' : ''].filter(Boolean).join('; ');
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${createSession(user)}; ${base}; HttpOnly; Max-Age=${SESSION_TTL_MS / 1000}`,
    `${CSRF_COOKIE}=${csrf}; ${base}; Max-Age=${SESSION_TTL_MS / 1000}`
  ]);
}

export function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  ]);
}

export function sessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return readSession(cookies[COOKIE]);
}

/** `Authorization: Bearer ac_...` for token-authenticated API calls. */
export function tokenFromRequest(req) {
  const match = /^Bearer\s+(ac_[A-Za-z0-9_-]{20,})$/i.exec(String(req.headers.authorization || ''));
  return match ? match[1] : null;
}

export function csrfOk(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  const sent = req.headers['x-csrf'];
  if (!cookies[CSRF_COOKIE] || !sent) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(cookies[CSRF_COOKIE]);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ROLE_RANK = { readonly: 1, operator: 2, admin: 3 };

export function hasRole(session, minimum) {
  return (ROLE_RANK[session?.role] || 0) >= (ROLE_RANK[minimum] || 0);
}

/** Simple in-memory login throttle (per IP + username). */
const attempts = new Map();

export function throttleKey(req, username) {
  return `${req.ip}|${String(username || '').toLowerCase()}`;
}

export function tooManyAttempts(key, max) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.reset) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= max;
}

export function recordFailure(key) {
  const entry = attempts.get(key) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
  entry.count += 1;
  attempts.set(key, entry);
}

export function clearFailures(key) {
  attempts.delete(key);
}

