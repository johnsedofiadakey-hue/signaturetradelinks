import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const server = createServer(createApp({ db, config }));

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ level: 'info', message: `API listening on http://${config.host}:${config.port}/api/v1`, db: config.dbPath }));
});

function shutdown(signal) {
  console.info(JSON.stringify({ level: 'info', message: `Received ${signal}, shutting down` }));
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
