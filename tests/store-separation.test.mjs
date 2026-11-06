// The retail shop and the hire-purchase store must stay separate. See "The rule" in planning/RETAIL_HP_SEPARATION.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const folder = path => readdirSync(new URL(`../${path}`, import.meta.url)).filter(name => name.endsWith('.jsx')).map(name => `${path}/${name}`);

test('retail pages never mention hire purchase, monthly payments or assessment', () => {
  const retail = [...folder('src/retail'), 'src/components/HeroCarousel.jsx', 'src/components/ShoppingConfidence.jsx', 'src/components/ShoppableRoom.jsx'];
  for (const file of retail) assert.doesNotMatch(read(file), /hire.?purchase|\bmonthly\b|\bassessment\b|\binstalments?\b/i, file);
});

test('the hire-purchase store has its own cards and no way into the retail cart or product pages', () => {
  for (const file of folder('src/hire-purchase')) {
    const source = read(file);
    assert.doesNotMatch(source, /retail\/RetailHome|useBag|WishButton|\/checkout|to=\{`\/p\//, file);
  }
});

test('only the menu and footer link from one store to the other', () => {
  // Retail menu, help dialog and retail footer. The hire-purchase logo stays inside its own store.
  const links = read('src/components/shared.jsx').match(/<Link[^>]* to="\/hire-purchase"/g) ?? [];
  assert.ok(links.length <= 3, `found ${links.length} links to the hire-purchase store`);
});

test('the site never labels images as AI-made', () => {
  const pages = [...folder('src/retail'), ...folder('src/hire-purchase'), ...folder('src/components'), ...folder('src/discovery')];
  for (const file of pages) assert.doesNotMatch(read(file), /AI[- ](retouched|generated|touched|concept)/i, file);
});

