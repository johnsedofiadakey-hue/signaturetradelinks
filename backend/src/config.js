import { fileURLToPath } from 'node:url';

const DEFAULT_DB = fileURLToPath(new URL('../data/dev.sqlite', import.meta.url));

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    host: env.STL_API_HOST ?? '127.0.0.1',
    port: Number(env.STL_API_PORT ?? 8787),
    dbPath: env.STL_DB_PATH ?? DEFAULT_DB,
    // Browser origins allowed to make cookie-authenticated writes.
    allowedOrigins: (env.STL_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173')
      .split(',').map(origin => origin.trim()).filter(Boolean),
    // Outside production, any http://localhost or 127.0.0.1 port is accepted so Vite can pick a free port.
    allowLoopbackOrigins: !production && env.STL_ALLOW_LOOPBACK_ORIGINS !== '0',
    secureCookies: production || env.STL_SECURE_COOKIES === '1',
    sessionTtlMs: Number(env.STL_SESSION_TTL_HOURS ?? 8) * 60 * 60_000,
    trustProxy: env.STL_TRUST_PROXY === '1',
    logRequests: env.STL_LOG_REQUESTS !== '0',
  };
}
