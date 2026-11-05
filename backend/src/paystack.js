// Paystack hosted checkout. The browser never sees the secret key and never reports a payment as successful:
// money is only recognised from a signed webhook or a server-to-server verify call.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './http.js';

const BASE_URL = 'https://api.paystack.co';

export function paystackProvider({ secretKey, fetchImpl = globalThis.fetch, log = console }) {
  async function call(method, path, body) {
    let response;
    let payload;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      payload = await response.json();
    } catch (error) {
      log.error?.(JSON.stringify({ level: 'error', message: `Paystack ${path} unreachable`, detail: error.message }));
      fail('payment_provider_error', 'We could not reach the payment service. Please try again.');
    }
    if (!response.ok || !payload?.status) {
      log.error?.(JSON.stringify({ level: 'error', message: `Paystack ${path} refused`, status: response.status, detail: payload?.message }));
      fail('payment_provider_error', 'The payment service could not start this payment. Please try again.');
    }
    return payload.data;
  }

  return {
    configured: Boolean(secretKey),

    async initialize({ email, amountMinor, currency, reference, callbackUrl }) {
      const data = await call('POST', '/transaction/initialize', { email, amount: amountMinor, currency, reference, callback_url: callbackUrl });
      return { authorizationUrl: data.authorization_url };
    },

    /** Ask Paystack directly what happened. Only a verified "success" counts as paid. */
    async verify(reference) {
      const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      return { success: data.status === 'success', amountMinor: data.amount, currency: data.currency, providerId: String(data.id), paidAt: data.paid_at ?? null };
    },

    /** Paystack signs the exact webhook bytes with HMAC-SHA512 of the secret key. */
    verifySignature(rawBody, signature) {
      if (!secretKey || typeof signature !== 'string') return false;
      const expected = Buffer.from(createHmac('sha512', secretKey).update(rawBody).digest('hex'));
      const given = Buffer.from(signature);
      return expected.length === given.length && timingSafeEqual(expected, given);
    },
  };
}
