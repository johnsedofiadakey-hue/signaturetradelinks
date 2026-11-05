import { ERROR_CODES } from '../../shared/contract.js';

export class ApiError extends Error {
  constructor(code, message, { fieldErrors, status, headers } = {}) {
    super(message);
    this.code = code;
    this.status = status ?? ERROR_CODES[code] ?? 500;
    this.fieldErrors = fieldErrors;
    this.headers = headers;
  }
}

export const fail = (code, message, extra) => { throw new ApiError(code, message, extra); };

const MAX_BODY_BYTES = 100_000;

/** The request body as bytes. Webhook signatures are computed over exactly these bytes. */
export async function readRaw(req) {
  if (Buffer.isBuffer(req.rawBody)) {
    // Cloud Functions has already consumed the stream and exposes the bytes as rawBody.
    if (req.rawBody.length > MAX_BODY_BYTES) fail('payload_too_large', 'The request body is too large.');
    return req.rawBody;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) fail('payload_too_large', 'The request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const raw = await readRaw(req);
  const size = raw.length;
  if (size === 0) return {};
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  // Requiring JSON forces a CORS preflight for cross-site browser requests.
  if (type !== 'application/json') fail('unsupported_media_type', 'Requests must be sent as JSON.');
  try {
    const body = JSON.parse(raw.toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('bad_request', 'The request body must be a JSON object.');
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail('invalid_json', 'The request body is not valid JSON.');
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function send(res, status, payload, headers = {}) {
  const body = status === 204 ? '' : JSON.stringify(payload);
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAgeSeconds, path = '/', secure, httpOnly = true, sameSite = 'Strict' }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor, length) {
  if (cursor === undefined || cursor === '') return null;
  try {
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(values) && values.length === length && values.every(v => typeof v === 'string')) return values;
  } catch { /* fall through */ }
  fail('validation_failed', 'The cursor is invalid.', { fieldErrors: { cursor: 'Invalid cursor.' } });
}

export function parseLimit(raw, { fallback = 24, max = 50 } = {}) {
  if (raw == null || raw === '') return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    fail('validation_failed', 'The limit is invalid.', { fieldErrors: { limit: `Use a whole number from 1 to ${max}.` } });
  }
  return limit;
}
