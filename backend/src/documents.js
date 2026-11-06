// Private storage for assessment documents. Files only ever pass through the API, so there are no links to leak and every staff view can be audited.
import { getStorage } from 'firebase-admin/storage';
import { appOf } from './firestore.js';
import { fail } from './http.js';

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** The real type from the file's first bytes. What the browser says it is doesn't count. */
export function sniffType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export function firebaseDocumentStore(db, bucketName, log = console) {
  const bucket = () => getStorage(appOf(db)).bucket(bucketName);
  const unavailable = (error, action) => {
    // Usually the bucket not existing yet, or the API's account lacking access. Names and contents are never logged.
    log.error?.(JSON.stringify({ level: 'error', message: `document ${action} failed`, code: error.code ?? null }));
    fail('not_configured', 'Document storage is not available right now. Please try again later.');
  };
  return {
    async save(path, bytes, contentType) {
      try {
        await bucket().file(path).save(bytes, { contentType, resumable: false, metadata: { cacheControl: 'private, no-store' } });
      } catch (error) { unavailable(error, 'save'); }
    },
    async read(path) {
      try {
        const [bytes] = await bucket().file(path).download();
        return bytes;
      } catch (error) { return unavailable(error, 'read'); }
    },
    async remove(path) {
      try {
        await bucket().file(path).delete({ ignoreNotFound: true });
      } catch (error) { log.error?.(JSON.stringify({ level: 'error', message: 'document delete failed', code: error.code ?? null })); }
    },
  };
}
