export const RECENT_KEY = 'stl.recent.v1';
export const MAX_COMPARE = 3;
export const USE_OPTIONS = [
  { id: 'any', label: 'No preference' },
  { id: 'movies', label: 'Films & TV' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'music', label: 'Music & listening' },
  { id: 'chores', label: 'Everyday home tasks' },
  { id: 'work', label: 'Work & study' },
];
const useAliases = { movies:'movies', films:'movies', 'films & tv':'movies', gaming:'gaming', music:'music', 'music & listening':'music', chores:'chores', 'everyday home tasks':'chores', work:'work', 'work & study':'work' };
export function confirmedUses(product, detail) {
  const explicit = [...(Array.isArray(product.useCases) ? product.useCases : []), ...(Array.isArray(detail?.useCases) ? detail.useCases : [])];
  for (const spec of detail?.specifications ?? []) {
    if (/^(use cases|recommended use|intended use|suitable for)$/i.test(String(spec.label).trim())) explicit.push(...String(spec.value).split(/[,;|]/));
  }
  return [...new Set(explicit.map(v => useAliases[String(v).trim().toLowerCase()]).filter(Boolean))];
}
export function minorBudget(amount, currency) {
  const value = Number(amount);
  if (String(amount).trim() === '' || !Number.isFinite(value) || value <= 0 || !currency) return null;
  const digits = new Intl.NumberFormat('en', { style:'currency', currency }).resolvedOptions().maximumFractionDigits;
  return Math.round(value * 10 ** digits);
}
export function findProducts(products, details, { category = 'all', budget = '', currency = '', use = 'any' }) {
  const limit = minorBudget(budget, currency);
  const candidates = products.filter(p => (category === 'all' || p.categorySlug === category) && p.availability !== 'out_of_stock');
  const matches = [], incomplete = [];
  for (const product of candidates) {
    const uses = confirmedUses(product, details[product.slug]);
    const missingPrice = limit !== null && !product.price;
    const missingUse = use !== 'any' && uses.length === 0;
    // Known mismatches must never be presented as unverified matches.
    if (limit !== null && product.price && (product.price.currency !== currency || product.price.amountMinor > limit)) continue;
    if (use !== 'any' && uses.length && !uses.includes(use)) continue;
    if (missingPrice || missingUse) incomplete.push(product);
    else matches.push(product);
  }
  return { matches, incomplete, limit };
}
export function rememberSlug(current, slug) {
  if (typeof slug !== 'string' || !slug || slug.length > 250) return current;
  return [slug, ...current.filter(s => s !== slug)].slice(0, 8);
}
export function whatsappUrl(number, product, origin) {
  const digits = String(number ?? '').replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  const message = `Hello Signature Tradelink, I'd like to ask about ${product.name}.\nProduct: ${origin}/p/${encodeURIComponent(product.slug)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
