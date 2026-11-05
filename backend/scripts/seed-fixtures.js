// Loads the storefront's illustrative catalogue so the admin portal has something to manage.
// Every product is flagged illustrative, unpriced and stockless. Writing to a live project needs --confirm-live.
import { products } from '../../src/catalogue.js';
import { recordAudit } from '../src/audit.js';
import { C, newId, now, transaction } from '../src/firestore.js';
import { openTarget } from './target.js';

const CATEGORY_ORDER = ['Audio', 'TV & Entertainment', 'Cooling', 'Home Appliances', 'Phones & Computing'];
const slugify = text => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const { db, values, emulator, label } = openTarget({ 'confirm-live': { type: 'boolean' } });
if (!emulator && !values['confirm-live']) {
  console.error(`Refusing to write illustrative fixtures to ${label} without --confirm-live.`);
  process.exit(1);
}

const summary = await transaction(db, async tx => {
  if (!(await tx.get(db.collection(C.products).limit(1))).empty) return null;
  const at = now();
  const categoryIds = new Map();
  CATEGORY_ORDER.forEach((label, index) => {
    const id = newId('cat');
    const slug = slugify(label);
    tx.create(db.collection(C.categorySlugs).doc(slug), { categoryId: id });
    tx.create(db.collection(C.categories).doc(id), { slug, label, sortOrder: (index + 1) * 10, published: true, version: 1, createdAt: at, updatedAt: at });
    categoryIds.set(label, id);
  });
  for (const product of products) {
    const id = newId('prd');
    const slug = slugify(product.name);
    tx.create(db.collection(C.productSlugs).doc(slug), { productId: id });
    tx.create(db.collection(C.products).doc(id), {
      slug, title: product.name, description: product.description, tagline: product.tag, categoryId: categoryIds.get(product.category), brand: null,
      specifications: [], images: product.image ? [{ src: product.image, alt: `Illustrative ${product.name.toLowerCase()}` }] : [],
      illustration: product.illustration ?? null, publishStatus: 'published', hirePurchaseEnabled: product.hirePurchase, illustrative: true,
      version: 1, createdAt: at, updatedAt: at,
    });
  }
  recordAudit(db, tx, { actor: null, action: 'fixtures.seeded', resourceType: 'catalogue', metadata: { products: products.length, illustrative: true } });
  return { categories: CATEGORY_ORDER.length, products: products.length };
});

console.info(summary
  ? `Seeded ${summary.categories} categories and ${summary.products} illustrative products (unpriced) into ${label}.`
  : `Catalogue in ${label} already has products; nothing seeded.`);
