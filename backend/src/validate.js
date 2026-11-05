import { fail } from './http.js';

// Each rule returns { value } when valid or { error } with a customer-safe message.
const ok = value => ({ value });
const bad = error => ({ error });

export const str = ({ min = 1, max = 200, pattern, patternMessage, trim = true } = {}) => input => {
  if (typeof input !== 'string') return bad('Must be text.');
  const value = trim ? input.trim() : input;
  if (value.length < min) return bad(min === 1 ? 'Required.' : `Use at least ${min} characters.`);
  if (value.length > max) return bad(`Use ${max} characters or fewer.`);
  if (pattern && !pattern.test(value)) return bad(patternMessage ?? 'Invalid format.');
  return ok(value);
};

export const bool = () => input => (typeof input === 'boolean' ? ok(input) : bad('Must be true or false.'));

export const int = ({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, nonZero = false } = {}) => input => {
  if (!Number.isSafeInteger(input)) return bad('Must be a whole number.');
  if (input < min || input > max) return bad(`Must be between ${min} and ${max}.`);
  if (nonZero && input === 0) return bad('Must not be zero.');
  return ok(input);
};

export const oneOf = values => input => (values.includes(input) ? ok(input) : bad(`Must be one of: ${values.join(', ')}.`));

export const nullable = rule => input => (input === null ? ok(null) : rule(input));

export const arrayOf = (rule, { max = 20 } = {}) => input => {
  if (!Array.isArray(input)) return bad('Must be a list.');
  if (input.length > max) return bad(`Use ${max} items or fewer.`);
  const value = [];
  for (const [index, item] of input.entries()) {
    const result = rule(item);
    if (result.error) return bad(`Item ${index + 1}: ${result.error}`);
    value.push(result.value);
  }
  return ok(value);
};

export const shape = spec => input => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('Must be an object.');
  const value = {};
  for (const key of Object.keys(input)) if (!(key in spec)) return bad(`Unknown field "${key}".`);
  for (const [key, rule] of Object.entries(spec)) {
    const result = rule(input[key]);
    if (result.error) return bad(`${key}: ${result.error}`);
    value[key] = result.value;
  }
  return ok(value);
};

export const stringMap = ({ maxEntries = 10, keyMax = 40, valueMax = 80 } = {}) => input => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('Must be an object of text values.');
  const entries = Object.entries(input);
  if (entries.length > maxEntries) return bad(`Use ${maxEntries} entries or fewer.`);
  const value = {};
  for (const [key, val] of entries) {
    if (!key.trim() || key.length > keyMax) return bad(`Keys must be 1–${keyMax} characters.`);
    if (typeof val !== 'string' || !val.trim() || val.length > valueMax) return bad(`Values must be 1–${valueMax} characters of text.`);
    value[key.trim()] = val.trim();
  }
  return ok(value);
};

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
export const currency = () => input => (typeof input === 'string' && CURRENCIES.has(input) ? ok(input) : bad('Must be an ISO 4217 currency code such as GHS.'));

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKU = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Local public assets or HTTPS media only.
export const IMAGE_SRC = /^(\/[A-Za-z0-9._\-/]+|https:\/\/[^\s"'<>]+)$/;

/**
 * Validate a request body against a spec of rules.
 * Unknown keys are rejected. In partial mode only supplied keys are checked; otherwise
 * every key is required unless listed in `optional`.
 */
export function validate(input, spec, { partial = false, optional = [] } = {}) {
  const fieldErrors = {};
  const value = {};
  for (const key of Object.keys(input ?? {})) if (!(key in spec)) fieldErrors[key] = 'Unknown field.';
  for (const [key, rule] of Object.entries(spec)) {
    if (input?.[key] === undefined) {
      if (!partial && !optional.includes(key)) fieldErrors[key] = 'Required.';
      continue;
    }
    const result = rule(input[key]);
    if (result.error) fieldErrors[key] = result.error;
    else value[key] = result.value;
  }
  if (Object.keys(fieldErrors).length) fail('validation_failed', 'Some details need attention.', { fieldErrors });
  return value;
}
