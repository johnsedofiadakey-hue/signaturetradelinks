// Shared by the CLI scripts: resolve which Firestore project to write to, defaulting to the local emulator.
import { parseArgs } from 'node:util';
import { openFirestore } from '../src/firestore.js';

export function openTarget(extraOptions = {}) {
  const { values } = parseArgs({ options: { project: { type: 'string' }, ...extraOptions } });
  const projectId = values.project ?? 'demo-signature';
  const emulator = projectId.startsWith('demo-');
  if (emulator) process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  else delete process.env.FIRESTORE_EMULATOR_HOST;
  const label = emulator ? `local emulator (${projectId})` : `LIVE project ${projectId}`;
  return { db: openFirestore(projectId), values, projectId, emulator, label };
}
