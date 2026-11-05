import { randomUUID } from 'node:crypto';
import { API_BASE } from '../../shared/contract.js';
import { ApiError, readJson, send } from './http.js';
import { registerPublic } from './routes/public.js';
import { registerAdminAuth } from './routes/admin-auth.js';
import { registerAdminCatalogue } from './routes/admin-catalogue.js';
import { registerAdminInventory } from './routes/admin-inventory.js';
import { registerAdminStaff } from './routes/admin-staff.js';
import { registerAdminOperations } from './routes/admin-operations.js';
import { registerCheckout } from './routes/checkout.js';
import { registerAdminOrders } from './routes/admin-orders.js';
import { registerUnavailable } from './routes/unavailable.js';
import { paystackProvider } from './paystack.js';

function compile(path) {
  const keys = [];
  const pattern = path.replace(/\/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

/** Build the API request handler. Everything stateful is injected so tests can run against isolated emulator projects. */
export function createApp({ db, config, log = console, payments = paystackProvider({ secretKey: config.paystackSecretKey, log }) }) {
  const routes = [];
  const route = (method, path, handler, options = {}) => routes.push({ method, path, handler, options, ...compile(path) });

  registerPublic(route);
  registerAdminAuth(route, db);
  registerAdminCatalogue(route);
  registerAdminInventory(route);
  registerAdminStaff(route);
  registerAdminOperations(route);
  registerCheckout(route, db, payments, config);
  registerAdminOrders(route);
  registerUnavailable(route);

  function match(method, pathname) {
    let pathMatched = false;
    for (const candidate of routes) {
      const found = candidate.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (candidate.method !== method) continue;
      let params;
      try {
        params = Object.fromEntries(candidate.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])]));
      } catch {
        return { error: new ApiError('not_found', 'Not found.') };
      }
      return { candidate, params };
    }
    return { error: pathMatched ? new ApiError('bad_request', 'Method not allowed.', { status: 405 }) : new ApiError('not_found', 'Not found.') };
  }

  return async function handle(req, res) {
    const requestId = `req_${randomUUID().replaceAll('-', '')}`;
    const started = performance.now();
    const url = new URL(req.url, 'http://localhost');
    let status = 500;
    try {
      if (!url.pathname.startsWith(`${API_BASE}/`)) throw new ApiError('not_found', 'Not found.');
      const pathname = url.pathname.slice(API_BASE.length).replace(/\/+$/, '') || '/';
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const { candidate, params, error } = match(method, pathname);
      if (error) throw error;
      const ip = (config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
      const body = candidate.options.skipBody ? undefined : await readJson(req);
      const ctx = { req, res, db, config, params, query: url.searchParams, body, requestId, ip };
      const result = await candidate.handler(ctx);
      status = result.status ?? 200;
      send(res, status, status === 204 ? null : { data: result.data, requestId }, { 'X-Request-Id': requestId, ...result.headers });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        log.error?.(JSON.stringify({ level: 'error', requestId, message: error.message, stack: error.stack }));
        error = new ApiError('internal_error', 'Something went wrong. Please try again.');
      }
      status = error.status;
      send(res, status, {
        error: { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) },
        requestId,
      }, { 'X-Request-Id': requestId, ...error.headers });
    } finally {
      // Path only: query strings can carry search terms, and bodies are never logged.
      if (config.logRequests) {
        log.info?.(JSON.stringify({ level: 'info', requestId, method: req.method, path: url.pathname, status, ms: Math.round(performance.now() - started) }));
      }
    }
  };
}
