// Hire-purchase customer sign-in and API calls. Loaded only on the application and account pages, to keep the shop light.
// Firebase's web config identifies the project and is public by design; access is enforced by the API.
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, isSignInWithEmailLink, onAuthStateChanged, sendSignInLinkToEmail, signInWithEmailLink, signInWithPopup, signOut,
} from 'firebase/auth';

const API = '/api/v1';
const EMAIL_KEY = 'stl.signInEmail';
const emulator = import.meta.env.VITE_AUTH_EMULATOR;

const app = initializeApp(emulator
  ? { apiKey: 'demo-key', projectId: import.meta.env.VITE_FIREBASE_PROJECT ?? 'demo-signature', authDomain: 'localhost' }
  : { apiKey: 'AIzaSyD7u3xyXPGUmC_y8rezvigsvJi7G_Q6HCM', authDomain: 'signaturetradelinks.firebaseapp.com', projectId: 'signaturetradelinks', appId: '1:173781217052:web:55e5be3995ebb0c635d4d9' });
const auth = getAuth(app);
if (emulator) connectAuthEmulator(auth, emulator, { disableWarnings: true });

export class CustomerError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.fieldErrors = body?.error?.fieldErrors ?? {};
  }
}

/** Firebase's own failures, put in words a customer can act on. Closing the Google window is not an error. */
export function signInMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/popup-blocked': return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code': return 'That sign-in link has expired or was already used. Ask for a new one below.';
    case 'auth/operation-not-allowed':
    case 'auth/unauthorized-domain': return 'This way of signing in is not switched on yet. Please contact us.';
    case 'auth/network-request-failed': return 'We could not reach the sign-in service. Check your connection and try again.';
    default: return 'We could not sign you in. Please try again.';
  }
}

export const watchCustomer = callback => onAuthStateChanged(auth, callback);
export const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOutCustomer = () => signOut(auth);

export async function emailSignInLink(email, returnPath) {
  await sendSignInLinkToEmail(auth, email, { url: `${window.location.origin}${returnPath}`, handleCodeInApp: true });
  try { window.localStorage.setItem(EMAIL_KEY, email); } catch { /* they will be asked to type it when the link opens */ }
}

export const openedFromEmailLink = () => isSignInWithEmailLink(auth, window.location.href);

export function rememberedEmail() {
  try { return window.localStorage.getItem(EMAIL_KEY); } catch { return null; }
}

/** Finish signing in from an emailed link. The address is confirmed again if the link was opened on another device. */
export async function completeEmailLink(email) {
  const href = window.location.href;
  await signInWithEmailLink(auth, email, href);
  try { window.localStorage.removeItem(EMAIL_KEY); } catch { /* nothing to clean up */ }
  window.history.replaceState(null, '', window.location.pathname);
}

async function call(method, path, body, { signedIn = true } = {}) {
  const token = signedIn ? await auth.currentUser?.getIdToken() : null;
  const response = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new CustomerError(response.status, parsed);
  return parsed.data;
}

export const loadOptions = () => call('GET', '/hire-purchase/options', undefined, { signedIn: false });
export const loadApplication = () => call('GET', '/me/hire-purchase/application');
export const saveSection = body => call('PATCH', '/me/hire-purchase/application', body);
export const submitApplication = body => call('POST', '/me/hire-purchase/application/submit', body);
export const withdrawApplication = expectedVersion => call('POST', '/me/hire-purchase/application/withdraw', { expectedVersion });
export const restartApplication = expectedVersion => call('POST', '/me/hire-purchase/application/reopen', { expectedVersion });

// Documents. Phone photos are shrunk first: staff don't need 12 megapixels, and mobile data isn't free.
const MAX_PHOTO_SIDE = 2000;

async function shrinkPhoto(file) {
  if (file.type === 'application/pdf' || !window.createImageBitmap) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // The server decides whether it is a usable file.
  }
}

export async function uploadDocument(type, file) {
  const token = await auth.currentUser?.getIdToken();
  const body = await shrinkPhoto(file);
  const response = await fetch(`${API}/me/hire-purchase/application/documents/${type}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body,
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new CustomerError(response.status, parsed);
  return parsed.data;
}

export const removeDocument = type => call('DELETE', `/me/hire-purchase/application/documents/${type}`);

export async function loadDocument(type) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`${API}/me/hire-purchase/application/documents/${type}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new CustomerError(response.status, null);
  return response.blob();
}

// Buying.
export const loadBuying = () => call('GET', '/me/hire-purchase/buying');
export const requestHpQuote = body => call('POST', '/me/hire-purchase/quote', body);
export const loadAgreements = () => call('GET', '/me/hire-purchase/agreements');
export const loadAgreement = id => call('GET', `/me/hire-purchase/agreements/${id}`);
export const startDeposit = id => call('POST', `/me/hire-purchase/agreements/${id}/deposit`, {});
export const startInstalment = id => call('POST', `/me/hire-purchase/agreements/${id}/pay`, {});
export const verifyAgreement = id => call('POST', `/me/hire-purchase/agreements/${id}/verify`, {});

export async function acceptAgreement(body, idempotencyKey) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`${API}/me/hire-purchase/agreements`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new CustomerError(response.status, parsed);
  return parsed.data;
}
