// The shop: every product at /shop, one category at /shop/:category. Categories are real links, so they can be shared.
import { ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import { OfflineNote, useReveal } from '../components/shared';
import { Link, navigate } from '../router';
import { useCatalogue } from '../state';
import { ProductCard } from './RetailHome';

export default function ShopPage({ categorySlug, query, onResetQuery }) {
  const { status, categories, products } = useCatalogue();
  const category = categories.find(c => c.slug === categorySlug);
  const needle = query.trim().toLowerCase();
  const shown = products.filter(p => (!categorySlug || p.categorySlug === categorySlug) && `${p.name} ${p.category} ${p.brand ?? ''}`.toLowerCase().includes(needle));
  useReveal([status, categorySlug, query]);

  if (categorySlug && !category && status !== 'loading') {
    return (
      <main className="section narrow-page">
        <p className="eyebrow">NOT FOUND</p>
        <h1 className="page-title">We couldn’t find that category.</h1>
        <p className="muted">It may have been renamed or is no longer available.</p>
        <Link className="button dark" to="/shop">See all products <ArrowUpRight size={18} /></Link>
      </main>
    );
  }

  return (
    <main className="retail-landing shop-page section">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {category ? <Link to="/shop"><ArrowLeft size={14} /> All products</Link> : <Link to="/"><ArrowLeft size={14} /> Home</Link>}
      </nav>
      <header className="shop-heading">
        <h1 className="page-title">{category?.label ?? 'All products'}</h1>
        <p className="muted">{status === 'loading' ? 'Loading the collection…' : `${shown.length} ${shown.length === 1 ? 'product' : 'products'}${needle ? ` for “${query.trim()}”` : ''}`}</p>
      </header>
      <nav className="shop-categories" aria-label="Shop by category">
        <Link to="/shop" aria-current={!categorySlug ? 'page' : undefined}>All products</Link>
        {categories.map(({ slug, label }) => <Link key={slug} to={`/shop/${slug}`} aria-current={slug === categorySlug ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <OfflineNote />
      <div className="product-grid studio-grid">
        {shown.map(p => <ProductCard key={p.id} product={p} to={`/p/${p.slug}`} shopActions />)}
      </div>
      {status === 'ready' && shown.length === 0 && (
        <div className="empty">
          <Search />
          <h3>No products found</h3>
          <p>{needle ? 'Try another search or category.' : 'Nothing here yet. Please check back soon.'}</p>
          <button className="button dark" onClick={() => { onResetQuery(); navigate('/shop'); }}>See all products</button>
        </div>
      )}
    </main>
  );
}
