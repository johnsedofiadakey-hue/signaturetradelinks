import { publicProductDto } from '../catalogue.js';
import { decodeCursor, encodeCursor, fail, parseLimit } from '../http.js';

const PUBLISHED_PRODUCT = `
  SELECT p.*, c.slug AS category_slug, c.label AS category_label
  FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.publish_status = 'published' AND c.published = 1`;

export const likePattern = q => `%${q.toLowerCase().replace(/[\\%_]/g, match => `\\${match}`)}%`;

export function registerPublic(route) {
  route('GET', '/health', () => ({ data: { status: 'ok' } }));

  route('GET', '/categories', ({ db }) => ({
    data: db.prepare('SELECT * FROM categories WHERE published = 1 ORDER BY sort_order, label').all()
      .map(({ id, slug, label, sort_order }) => ({ id, slug, label, sortOrder: sort_order })),
  }));

  route('GET', '/products', ({ db, query }) => {
    const limit = parseLimit(query.get('limit'));
    const cursor = decodeCursor(query.get('cursor') ?? undefined, 2);
    const where = [];
    const params = [];
    const category = query.get('category');
    if (category) { where.push('c.slug = ?'); params.push(category); }
    const q = query.get('q')?.trim();
    if (q) {
      if (q.length > 100) fail('validation_failed', 'The search is too long.', { fieldErrors: { q: 'Use 100 characters or fewer.' } });
      where.push(`(lower(p.title) LIKE ? ESCAPE '\\' OR lower(p.description) LIKE ? ESCAPE '\\' OR lower(COALESCE(p.brand, '')) LIKE ? ESCAPE '\\' OR lower(c.label) LIKE ? ESCAPE '\\')`);
      params.push(...Array(4).fill(likePattern(q)));
    }
    const hirePurchase = query.get('hirePurchase');
    if (hirePurchase !== null && hirePurchase !== '') {
      if (!['true', 'false'].includes(hirePurchase)) fail('validation_failed', 'The hire purchase filter is invalid.', { fieldErrors: { hirePurchase: 'Use true or false.' } });
      where.push('p.hire_purchase_enabled = ?');
      params.push(hirePurchase === 'true' ? 1 : 0);
    }
    if (cursor) { where.push('(lower(p.title) > ? OR (lower(p.title) = ? AND p.id > ?))'); params.push(cursor[0], cursor[0], cursor[1]); }
    const rows = db.prepare(`${PUBLISHED_PRODUCT} ${where.map(w => `AND ${w}`).join(' ')} ORDER BY lower(p.title), p.id LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: {
        items: page.map(row => publicProductDto(db, row)),
        nextCursor: rows.length > limit ? encodeCursor([last.title.toLowerCase(), last.id]) : null,
      },
    };
  });

  route('GET', '/products/:slug', ({ db, params }) => {
    const row = db.prepare(`${PUBLISHED_PRODUCT} AND p.slug = ?`).get(params.slug);
    if (!row) fail('not_found', 'We could not find that product.');
    return { data: publicProductDto(db, row, { detail: true }) };
  });
}
