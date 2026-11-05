// Cloud Functions entry point. Firebase Hosting rewrites /api/** to this function.
import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openFirestore } from './firestore.js';

const config = loadConfig();
const handler = createApp({ db: openFirestore(), config });

// Runs as a dedicated service account that holds only roles/datastore.user (Firestore read/write).
export const api = onRequest({
  region: 'europe-west1',
  serviceAccount: 'stl-api@signaturetradelinks.iam.gserviceaccount.com',
  memory: '512MiB',
  concurrency: 40,
  maxInstances: 5,
  timeoutSeconds: 30,
  invoker: 'public',
}, handler);
