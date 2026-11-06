// Hire-purchase customers sign in with Firebase Auth (Google or an emailed link), which is separate from staff accounts.
// The browser sends its ID token as a Bearer header, so there is no cookie and no CSRF surface here.
import { getAuth } from 'firebase-admin/auth';
import { appOf } from './firestore.js';
import { fail } from './http.js';

export const firebaseCustomerAuth = db => ({ verifyIdToken: token => getAuth(appOf(db)).verifyIdToken(token) });

/** The signed-in customer. An unconfirmed email is refused, because the email is what the approval is sent to. */
export async function requireCustomer(ctx, customerAuth) {
  const header = ctx.req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) fail('unauthenticated', 'Please sign in to continue.');
  let claims;
  try {
    claims = await customerAuth.verifyIdToken(token);
  } catch {
    fail('unauthenticated', 'Your sign-in has expired. Please sign in again.');
  }
  if (!claims.email || !claims.email_verified) fail('forbidden', 'Please confirm your email address to continue.');
  return { uid: claims.uid, email: claims.email.toLowerCase() };
}

/**
 * Sends an approved customer a single-use sign-in link through Firebase's own email, which needs no mail provider.
 * Firebase's wording is a generic "sign in" message, so the link lands on the account page that says they are approved.
 * Swap this for a branded sender when the owner chooses an email provider and domain.
 */
export function firebaseSignInEmail({ apiKey, publicOrigin, log = console, baseUrl = process.env.FIREBASE_AUTH_EMULATOR_HOST ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com' }) {
  return {
    async send(email) {
      if (!apiKey) return { sent: false, reason: 'not_configured' };
      try {
        const response = await fetch(`${baseUrl}/v1/accounts:sendOobCode?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: `${publicOrigin}/hire-purchase/account`, canHandleCodeInApp: true }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return { sent: true };
        // Firebase's error names the cause (for example the provider being switched off) and carries no personal data.
        const failure = await response.json().catch(() => null);
        log.error?.(JSON.stringify({ level: 'error', message: 'sign-in email refused', status: response.status, reason: failure?.error?.message }));
        return { sent: false, reason: 'refused' };
      } catch (error) {
        log.error?.(JSON.stringify({ level: 'error', message: 'sign-in email failed', reason: error.name }));
        return { sent: false, reason: 'unreachable' };
      }
    },
  };
}
