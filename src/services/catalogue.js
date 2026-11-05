// Storefront catalogue adapter. Reads the public API and normalises it to the shape the UI renders.
// If the API cannot be reached, it falls back to the bundled illustrative fixtures and says so
// (source: 'fixtures'), so the preview still works without the backend running.
import { products as fixtures } from '../catalogue';

const API = '/api/v1';

const slugify = text => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(path, signal) {
  // no-store: never reuse a cached response, e.g. a hosting 404 cached before the API was deployed.
  const response = await fetch(`${API}${path}`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Catalogue request failed (${response.status})`);
  return body.data;
}

async function allProducts(signal) {
  const items = [];
  let cursor = '';
  do {
    const page = await get(`/products?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const fromSummary = p => ({
  id: p.id,
  slug: p.slug,
  name: p.title,
  category: p.category.label,
  categorySlug: p.category.slug,
  tag: p.tagline,
  brand: p.brand,
  useCases: Array.isArray(p.useCases) ? p.useCases.filter(v => typeof v === 'string') : [],
  image: p.images[0]?.src,
  imageAlt: p.images[0]?.alt,
  illustration: p.illustration,
  illustrative: p.illustrative,
  hirePurchase: p.hirePurchaseEnabled,
  price: p.price && { amountMinor: p.price.fromAmountMinor, currency: p.price.currency, varies: p.price.varies },
  availability: p.availability,
});

const fromFixture = p => ({
  ...p,
  slug: p.id,
  categorySlug: slugify(p.category),
  illustrative: true,
  price: null,
  availability: 'unconfirmed',
});

export async function loadCatalogue(signal) {
  try {
    const [categories, products] = await Promise.all([get('/categories', signal), allProducts(signal)]);
    return { source: 'api', categories: categories.map(({ slug, label }) => ({ slug, label })), products: products.map(fromSummary) };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const labels = [...new Set(fixtures.map(p => p.category))];
    return { source: 'fixtures', categories: labels.map(label => ({ slug: slugify(label), label })), products: fixtures.map(fromFixture) };
  }
}

/** Full product detail: description, verified specifications and priced variants. */
export async function loadProductDetail(slug, signal) {
  const detail = await get(`/products/${encodeURIComponent(slug)}`, signal);
  return {
    description: detail.description,
    specifications: Array.isArray(detail.specifications) ? detail.specifications : [],
    useCases: Array.isArray(detail.useCases) ? detail.useCases.filter(v => typeof v === 'string') : [],
    variants: detail.variants,
    retailAvailable: detail.purchaseModes.retail.available,
  };
}

export function formatPrice(price) {
  if (!price) return 'Price to be confirmed';
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: price.currency }).resolvedOptions().maximumFractionDigits;
  const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amountMinor / 10 ** digits);
  return price.varies ? `From ${amount}` : amount;
}
