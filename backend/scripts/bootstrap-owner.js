// Trusted server-side tool: creates the first owner account directly in the database.
// Usage: npm run admin:bootstrap -- --email owner@example.com --name "Store Owner"
// Set STL_BOOTSTRAP_PASSWORD to choose the password; otherwise a strong one is generated and printed once.
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { bootstrapOwner } from '../src/routes/admin-staff.js';
import { MIN_PASSWORD_LENGTH } from '../src/auth.js';
import { EMAIL } from '../src/validate.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (!values.email || !EMAIL.test(values.email) || !values.name?.trim()) {
  console.error('Usage: npm run admin:bootstrap -- --email owner@example.com --name "Store Owner"');
  process.exit(1);
}

const supplied = process.env.STL_BOOTSTRAP_PASSWORD;
if (supplied && supplied.length < MIN_PASSWORD_LENGTH) {
  console.error(`STL_BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
const password = supplied ?? randomBytes(18).toString('base64url');

const config = loadConfig();
const db = openDatabase(config.dbPath);
try {
  await bootstrapOwner(db, { email: values.email.trim(), displayName: values.name.trim(), password });
  console.info(`Owner account created for ${values.email} in ${config.dbPath}.`);
  if (!supplied) console.info(`Generated password (shown once, store it in a password manager): ${password}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
