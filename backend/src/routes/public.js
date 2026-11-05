import { loadPublicCatalogue, publicProductDto } from '../catalogue.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';

/** In-memory keyset pagination over items sorted by (lowercase title, id). */
export function paginateByTitle(items, cursor, limit) {
  const sorted = items
    .map(item => ({ item, key: [item.title.toLowerCase(), item.id] }))
    .sort((a, b) => (a.key[0] === b.key[0] ? (a.key[1] < b.key[1] ? -1 : 1) : a.key[0] < b.key[0] ? -1 : 1));
  const start = cursor ? sorted.findIndex(({ key }) => key[0] > cursor[0] || (key[0] === cursor[0] && key[1] > cursor[1])) : 0;
  const page = start === -1 ? [] : sorted.slice(start, start + limit + 1);
  const last = page[limit - 1];
  return { items: page.slice(0, limit).map(({ item }) => item), nextCursor: page.length > limit ? encodeCursor(last.key) : null };
}

export const matches = (q, ...fields) => fields.some(field => (field ?? '').toLowerCase().includes(q.toLowerCase()));

export function registerPublic(route) {
  route('GET', '/health', () => ({ data: { status: 'ok' } }));

  route('GET', '/categories', async ({ db }) => {
    const { categories } = await loadPublicCatalogue(db);
    return {
      data: categories
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
        .map(({ id, slug, label, sortOrder }) => ({ id, slug, label, sortOrder })),
    };
  });

  route('GET', '/products', async ({ db, query }) => {
    const limit = parseLimit(query.get('limit'));
    const cursor = decodeCursor(query.get('cursor') ?? undefined, 2);
    const category = query.get('category');
    const q = query.get('q')?.trim();
    if (q && q.length > 100) fail('validation_failed', 'The search is too long.', { fieldErrors: { q: 'Use 100 characters or fewer.' } });
    const hirePurchase = query.get('hirePurchase');
    if (hirePurchase && !['true', 'false'].includes(hirePurchase)) {
      fail('validation_failed', 'The hire purchase filter is invalid.', { fieldErrors: { hirePurchase: 'Use true or false.' } });
    }
    const catalogue = await loadPublicCatalogue(db);
    const filtered = catalogue.products.filter(p =>
      (!category || p.category.slug === category)
      && (!q || matches(q, p.title, p.description, p.brand, p.category.label))
      && (!hirePurchase || p.hirePurchaseEnabled === (hirePurchase === 'true')));
    const page = paginateByTitle(filtered, cursor, limit);
    return { data: { items: page.items.map(p => publicProductDto(p, catalogue)), nextCursor: page.nextCursor } };
  });

  route('GET', '/products/:slug', async ({ db, params }) => {
    const catalogue = await loadPublicCatalogue(db);
    const product = catalogue.products.find(p => p.slug === params.slug);
    if (!product) fail('not_found', 'We could not find that product.');
    return { data: publicProductDto(product, catalogue, { detail: true }) };
  });
}
