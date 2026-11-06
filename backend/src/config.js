// Cloud Functions / Cloud Run set K_SERVICE; treat that as the live environment.
const LIVE_ORIGINS = 'https://signaturetradelinks.web.app,https://signaturetradelinks.firebaseapp.com';
// Firebase's web API key identifies the project and is public by design; it is also in the storefront bundle.
const LIVE_WEB_API_KEY = 'AIzaSyD7u3xyXPGUmC_y8rezvigsvJi7G_Q6HCM';
const DEV_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173';

export function loadConfig(env = process.env) {
  const live = Boolean(env.K_SERVICE) || env.NODE_ENV === 'production';
  return {
    live,
    host: env.STL_API_HOST ?? '127.0.0.1',
    port: Number(env.STL_API_PORT ?? 8787),
    // Local runs default to the Firestore emulator's demo project, so they can never touch live data by accident.
    projectId: env.STL_FIREBASE_PROJECT ?? env.GCLOUD_PROJECT ?? (live ? undefined : 'demo-signature'),
    // Browser origins allowed to make cookie-authenticated writes.
    allowedOrigins: (env.STL_ALLOWED_ORIGINS ?? (live ? LIVE_ORIGINS : DEV_ORIGINS)).split(',').map(origin => origin.trim()).filter(Boolean),
    // Outside the live environment, any http://localhost or 127.0.0.1 port is accepted so Vite can pick a free port.
    allowLoopbackOrigins: !live && env.STL_ALLOW_LOOPBACK_ORIGINS !== '0',
    secureCookies: live || env.STL_SECURE_COOKIES === '1',
    sessionTtlMs: Number(env.STL_SESSION_TTL_HOURS ?? 8) * 60 * 60_000,
    // Behind Firebase Hosting the client address arrives in X-Forwarded-For.
    trustProxy: live || env.STL_TRUST_PROXY === '1',
    logRequests: env.STL_LOG_REQUESTS !== '0',
    // Unset means online payment is not configured, and orders are refused rather than taken without a way to pay.
    paystackSecretKey: env.PAYSTACK_SECRET_KEY || null,
    // Orders one visitor can place per hour. Each order holds stock until it is paid or expires.
    orderRateLimit: Number(env.STL_ORDER_RATE_LIMIT ?? 10),
    // Private home for assessment documents. Security rules deny all browser access; only the API reads and writes.
    storageBucket: env.STL_STORAGE_BUCKET ?? (live ? 'signaturetradelinks.firebasestorage.app' : 'demo-signature.appspot.com'),
    // Used to ask Firebase to email an approved customer their sign-in link.
    firebaseWebApiKey: env.STL_FIREBASE_WEB_API_KEY ?? (live ? LIVE_WEB_API_KEY : null),
    // Where those links land.
    publicOrigin: env.STL_PUBLIC_ORIGIN ?? (live ? 'https://signaturetradelinks.web.app' : 'http://127.0.0.1:5173'),
  };
}
