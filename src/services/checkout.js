// Checkout API client. Totals always come from the server; the browser only sends SKUs and quantities.
const API = '/api/v1';
const tokenKey = reference => `stl.order.${reference}`;

export class CheckoutError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.fieldErrors = body?.error?.fieldErrors ?? {};
  }
}

async function call(method, path, { body, headers, signal } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new CheckoutError(response.status, parsed);
  return parsed.data;
}

// The order's private token is the customer's proof of ownership, so it stays on this device only.
export function rememberOrderToken(reference, token) {
  try { window.localStorage.setItem(tokenKey(reference), token); } catch { /* storage unavailable: the order page will explain */ }
}

export function orderToken(reference) {
  try { return window.localStorage.getItem(tokenKey(reference)); } catch { return null; }
}

const owned = reference => ({ 'X-Order-Token': orderToken(reference) ?? '' });

export const loadCheckoutOptions = signal => call('GET', '/checkout/options', { signal });
export const requestQuote = (body, signal) => call('POST', '/checkout/quote', { body, signal });
export const placeOrder = (body, idempotencyKey) => call('POST', '/orders', { body, headers: { 'Idempotency-Key': idempotencyKey } });
export const startPayment = reference => call('POST', `/orders/${encodeURIComponent(reference)}/payments`, { body: {}, headers: owned(reference) });
export const verifyPayment = reference => call('POST', `/orders/${encodeURIComponent(reference)}/payments/verify`, { body: {}, headers: owned(reference) });
