// TEST-ONLY fixtures: loads the storefront's illustrative catalogue into the local database so the
// admin portal has something to manage. Every product is flagged illustrative, unpriced and stockless.
// Never run against a production database.
import { loadConfig } from '../src/config.js';
import { newId, now, openDatabase, transaction } from '../src/db.js';
import { recordAudit } from '../src/audit.js';
import { products } from '../../src/catalogue.js';

const CATEGORY_ORDER = ['Audio', 'TV & Entertainment', 'Cooling', 'Home Appliances', 'Phones & Computing'];
const slugify = text => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const config = loadConfig();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed illustrative fixtures with NODE_ENV=production.');
  process.exit(1);
}
const db = openDatabase(config.dbPath);

const summary = transaction(db, () => {
  if (db.prepare('SELECT 1 FROM products LIMIT 1').get()) return null;
  const at = now();
  const categoryIds = new Map();
  CATEGORY_ORDER.forEach((label, index) => {
    const id = newId('cat');
    db.prepare('INSERT INTO categories (id, slug, label, sort_order, published, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(id, slugify(label), label, (index + 1) * 10, at, at);
    categoryIds.set(label, id);
  });
  for (const product of products) {
    db.prepare(`
      INSERT INTO products (id, slug, title, description, tagline, category_id, images, illustration, publish_status, hire_purchase_enabled, illustrative, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, 1, ?, ?)`).run(
      newId('prd'), slugify(product.name), product.name, product.description, product.tag, categoryIds.get(product.category),
      JSON.stringify(product.image ? [{ src: product.image, alt: `Illustrative ${product.name.toLowerCase()}` }] : []),
      product.illustration ?? null, Number(product.hirePurchase), at, at,
    );
  }
  recordAudit(db, { actor: null, action: 'fixtures.seeded', resourceType: 'catalogue', metadata: { products: products.length, testOnly: true } });
  return { categories: CATEGORY_ORDER.length, products: products.length };
});

console.info(summary
  ? `Seeded ${summary.categories} categories and ${summary.products} illustrative products (test-only, unpriced) into ${config.dbPath}.`
  : 'Catalogue already has products; nothing seeded.');
db.close();
