// Local API server. Uses the Firestore emulator (npm run emulators) for demo-* projects.
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openFirestore } from './firestore.js';

const config = loadConfig();
if (config.projectId?.startsWith('demo-')) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
const db = openFirestore(config.projectId);
const server = createServer(createApp({ db, config }));

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ level: 'info', message: `API listening on http://${config.host}:${config.port}/api/v1`, project: config.projectId, firestore: process.env.FIRESTORE_EMULATOR_HOST }));
});

function shutdown(signal) {
  console.info(JSON.stringify({ level: 'info', message: `Received ${signal}, shutting down` }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
