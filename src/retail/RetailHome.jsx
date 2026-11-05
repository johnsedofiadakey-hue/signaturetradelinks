// The retail shop: everything is bought outright by anyone. Hire purchase appears only as one quiet signpost.
import { ArrowUpRight, Grid2X2, Headphones, Plus, Search, Smartphone, Tv, WashingMachine, Wind } from 'lucide-react';
import HeroCarousel from '../components/HeroCarousel';
import { OfflineNote, ProductImage, useReveal } from '../components/shared';
import { Link, navigate } from '../router';
import { formatPrice } from '../services/catalogue';
import { useCatalogue } from '../state';

const categoryIcons = { audio: Headphones, 'tv-and-entertainment': Tv, cooling: Wind, 'home-appliances': WashingMachine, 'phones-and-computing': Smartphone };
const ALL = { slug: 'all', label: 'All products' };

const FAQ = [
  ['How do I pay?', 'You pay in full at checkout. Online payment opens with the live store; the prices you see then are the prices you pay, plus any delivery fee shown before you confirm.'],
  ['Can I collect in store?', 'Yes. At checkout you will choose delivery to your area or collection from our store. Delivery areas, fees and the store address will be confirmed before checkout opens.'],
  ['What if a product is out of stock?', 'It stays visible with an “Out of stock” label so you can check back. You can only check out with items we have in stock.'],
  ['Can I pay over time instead?', 'Hire purchase is a separate store for customers our team has assessed and approved. Visit the hire purchase store to see how it works.'],
];

export function ProductCard({ product, to }) {
  return (
    <article className="product-card" data-reveal>
      <Link className="product-image" to={to} aria-label={`View ${product.name}`}>
        {product.tag && <span className="product-tag">{product.tag}</span>}
        <ProductImage product={product} />
        <span className="product-open"><ArrowUpRight size={18} /></span>
        {(product.illustrative || product.illustration) && <span className="media-label">{product.illustration ? 'Illustration' : 'Illustrative photo'}</span>}
      </Link>
      <div className="product-meta">
        <span>{product.category}</span>
        <h3><Link to={to}>{product.name}</Link></h3>
        <p className="price">{formatPrice(product.price)}{product.availability === 'out_of_stock' && <span className="stock-note">Out of stock</span>}</p>
      </div>
    </article>
  );
}

export default function RetailHome({ search, query, onResetQuery }) {
  const { status, categories: loaded, products } = useCatalogue();
  const categories = [ALL, ...loaded];
  const requested = new URLSearchParams(search).get('category') ?? 'all';
  const category = categories.some(c => c.slug === requested) ? requested : 'all';
  const needle = query.trim().toLowerCase();
  const shown = products.filter(p => (category === 'all' || p.categorySlug === category) && `${p.name} ${p.category} ${p.brand ?? ''}`.toLowerCase().includes(needle));
  const categoryLabel = categories.find(c => c.slug === category)?.label ?? ALL.label;
  const choose = slug => navigate(slug === 'all' ? '/#shop' : `/?category=${slug}#shop`, { replace: true });
  useReveal([status, category, query]);

  return (
    <main>
      <HeroCarousel onBrowse={slug => navigate(`/?category=${slug}#shop`)} />
      <section className="shop section" id="shop">
        <div className="section-top" data-reveal>
          <div><p className="eyebrow">THE EVERYDAY, UPGRADED</p><h2>What’s your next upgrade?</h2></div>
          <span className="muted small">A little something for every part of life.</span>
        </div>
        <div className="category-grid" data-reveal>
          {categories.map(({ slug, label }) => {
            const Icon = categoryIcons[slug] ?? Grid2X2;
            return <button key={slug} onClick={() => choose(slug)} className={category === slug ? 'category active' : 'category'} aria-pressed={category === slug}><Icon size={26} strokeWidth={1.4} /><span>{label}</span></button>;
          })}
        </div>
        <div className="product-toolbar">
          <p><strong>{needle ? `Results for “${query.trim()}”` : category === 'all' ? 'Explore the collection' : categoryLabel}</strong><span>{status === 'loading' ? 'Loading the collection…' : `${shown.length} ${shown.length === 1 ? 'product' : 'products'}`}</span></p>
        </div>
        <OfflineNote />
        <div className="product-grid">
          {shown.map(p => <ProductCard key={p.id} product={p} to={`/p/${p.slug}`} />)}
        </div>
        {status === 'ready' && shown.length === 0 && (
          <div className="empty"><Search /><h3>No products found</h3><p>Try another search or category.</p><button className="button dark" onClick={() => { onResetQuery(); choose('all'); }}>Reset filters</button></div>
        )}
      </section>

      <section className="hp-signpost" data-reveal>
        <div>
          <p className="eyebrow">PREFER TO PAY OVER TIME?</p>
          <h2>Hire purchase has its own store.</h2>
          <p>For customers our team has assessed and approved. Apply once, then buy eligible products through your account.</p>
        </div>
        <Link className="button outline" to="/hire-purchase">Visit hire purchase <ArrowUpRight size={18} /></Link>
      </section>

      <section className="faq-section section" data-reveal>
        <div><p className="eyebrow">A FEW THINGS TO KNOW</p><h2>Good questions.<br />Clear answers.</h2></div>
        <div className="faq-list">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}<Plus size={17} /></summary><p>{a}</p></details>)}
        </div>
      </section>
    </main>
  );
}
