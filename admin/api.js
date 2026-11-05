import { API_BASE } from '../shared/contract.js';

let csrfToken = '';
export const setCsrfToken = token => { csrfToken = token ?? ''; };

export class ApiFailure extends Error {
  constructor(status, error, requestId) {
    super(error?.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error?.code ?? 'network_error';
    this.fieldErrors = error?.fieldErrors ?? {};
    this.requestId = requestId;
  }
}

export async function api(method, path, body, { idempotencyKey } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, { code: 'network_error', message: 'Cannot reach the API. Is it running (npm run api)?' });
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status, payload?.error, payload?.requestId);
  return payload.data;
}

const fractionDigits = currency => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;

export function formatMoney(amountMinor, currency) {
  if (amountMinor == null || !currency) return 'Not priced';
  const digits = fractionDigits(currency);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 10 ** digits);
}

/** Convert a typed major-unit amount ("1,250.50") to integer minor units without floating-point error. */
export function toMinor(text, currency) {
  const digits = fractionDigits(currency);
  const clean = String(text).replace(/[,\s]/g, '');
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{0,${digits}}))?$`).exec(clean);
  if (!match) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? '').padEnd(digits, '0') || 0);
}

export function toMajorText(amountMinor, currency) {
  if (amountMinor == null || !currency) return '';
  const digits = fractionDigits(currency);
  if (!digits) return String(amountMinor);
  const text = String(amountMinor).padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

export const formatDate = iso => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');
