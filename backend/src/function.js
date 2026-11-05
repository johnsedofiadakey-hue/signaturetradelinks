import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openFirestore } from './firestore.js';
import { expireDueOrders } from './orders.js';

const config = loadConfig();
const db = openFirestore();
const handler = createApp({ db, config });
// Both run as a dedicated service account that holds only roles/datastore.user (Firestore read/write).
const serviceAccount = 'stl-api@signaturetradelinks.iam.gserviceaccount.com';

export const api = onRequest({
  region: 'europe-west1',
  serviceAccount,
  // Set with `firebase functions:secrets:set PAYSTACK_SECRET_KEY`. Must exist before this function can deploy.
  secrets: ['PAYSTACK_SECRET_KEY'],
  memory: '512MiB', concurrency: 40, maxInstances: 5, timeoutSeconds: 30, invoker: 'public',
}, handler);

// Puts stock from abandoned, unpaid orders back on sale.
export const releaseExpiredOrders = onSchedule({
  region: 'europe-west1',
  serviceAccount,
  schedule: 'every 5 minutes',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async () => {
  const released = await expireDueOrders(db);
  console.info(JSON.stringify({ level: 'info', message: 'released expired orders', released }));
});
