// Hire-purchase application rules shared by the customer and staff routes.
import { ASSESSMENT_DOCUMENTS, ASSESSMENT_SECTIONS, fieldApplies } from '../../shared/assessment.js';
import { C, read, readAll } from './firestore.js';
import { fail } from './http.js';
import { int, oneOf, str } from './validate.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = text => DATE.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);
const MINIMUM_AGE = 18; // the age to enter a binding contract in Ghana

const RULES = {
  text: field => str({ max: field.max ?? 120 }),
  select: field => oneOf(field.options.map(choice => choice.value)),
  date: () => input => (typeof input === 'string' && realDate(input) ? { value: input } : { error: 'Enter a real date.' }),
  month: () => str({ max: 7, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, patternMessage: 'Enter the month and year.' }),
  pin: () => input => {
    const value = typeof input === 'string' ? input.trim().toUpperCase() : input;
    return typeof value === 'string' && /^GHA-\d{9}-\d$/.test(value) ? { value } : { error: 'Use the format on the card: GHA-123456789-0.' };
  },
  phone: () => str({ max: 20, pattern: /^\+?[0-9][0-9 -]{7,18}$/, patternMessage: 'Enter a valid phone number.' }),
  digitalAddress: () => str({ max: 20, pattern: /^[A-Za-z]{2}-?\d{3,4}-?\d{3,4}$/, patternMessage: 'Use a GhanaPostGPS address such as GA-183-8164.' }),
  money: () => int({ min: 0, max: 100_000_000_000 }),
  dayOfMonth: () => int({ min: 1, max: 31 }),
};

const blank = value => value === undefined || value === null || value === '';

/** Clean one section's answers for saving. Blanks are allowed in a draft, but anything entered must be valid. */
export function cleanSection(sectionId, input) {
  const section = ASSESSMENT_SECTIONS.find(candidate => candidate.id === sectionId);
  if (!section) fail('validation_failed', 'Some details need attention.', { fieldErrors: { section: 'Unknown section.' } });
  const known = new Map(section.fields.map(field => [field.key, field]));
  const fieldErrors = {};
  const values = {};
  for (const key of Object.keys(input ?? {})) if (!known.has(key)) fieldErrors[key] = 'Unknown field.';
  for (const field of section.fields) {
    const raw = input?.[field.key];
    if (blank(raw) || !fieldApplies(field, input)) { values[field.key] = null; continue; }
    const result = RULES[field.type](field)(raw);
    if (result.error) fieldErrors[field.key] = result.error;
    else values[field.key] = result.value;
  }
  if (Object.keys(fieldErrors).length) fail('validation_failed', 'Some details need attention.', { fieldErrors });
  return values;
}

/** Everything that must be true before an application can go to the team. Errors are keyed "section.field". */
export function submissionErrors({ sections, documents }) {
  const errors = {};
  for (const document of ASSESSMENT_DOCUMENTS) {
    if (!document.optional && !documents?.[document.id]) errors[`documents.${document.id}`] = 'Please add this.';
  }
  for (const section of ASSESSMENT_SECTIONS) {
    const values = sections?.[section.id];
    for (const field of section.fields) {
      if (!field.optional && fieldApplies(field, values) && blank(values?.[field.key])) errors[`${section.id}.${field.key}`] = 'Required.';
    }
  }
  const birth = sections?.identity?.dateOfBirth;
  if (birth) {
    const eighteenth = new Date(`${birth}T00:00:00Z`);
    eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + MINIMUM_AGE);
    if (eighteenth > new Date()) errors['identity.dateOfBirth'] = `You must be at least ${MINIMUM_AGE} to apply.`;
  }
  const pin = sections?.identity?.ghanaCardPin;
  if (pin && pin === sections?.guarantor?.ghanaCardPin) errors['guarantor.ghanaCardPin'] = 'Your guarantor must be someone else.';
  return errors;
}

/** The wording an applicant must agree to. Applications stay closed until the owner has set all of it. */
export async function loadApplicationTerms(db, tx) {
  const [privacy, declaration, currency] = await readAll(db, ['hirePurchase.privacyNotice', 'hirePurchase.declaration', 'store.currency'].map(key => db.collection(C.settings).doc(key)), tx);
  const value = snap => snap.data()?.value ?? null;
  return {
    open: value(privacy) !== null && value(declaration) !== null && value(currency) !== null,
    privacyNotice: value(privacy),
    privacyVersion: privacy.data()?.version ?? 0,
    declaration: value(declaration),
    declarationVersion: declaration.data()?.version ?? 0,
    currency: value(currency),
  };
}

export const applicationRef = (db, uid) => db.collection(C.hpApplications).doc(uid);

export async function loadApplication(db, uid, tx) {
  const snap = await read(applicationRef(db, uid), tx);
  return snap.exists ? snap.data() : null;
}

export function expectVersion(application, expectedVersion) {
  if ((application?.version ?? 0) !== expectedVersion) fail('stale_version', 'This application changed since you opened it. Reload and try again.');
}

/** Approval lasts to the end of its final day, Ghana time, which is UTC. */
export const approvalActive = application => application?.status === 'approved' && application.decision?.validUntil >= new Date().toISOString().slice(0, 10);
