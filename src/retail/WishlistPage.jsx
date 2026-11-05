// Products saved for later. There are no retail customer accounts, so the list lives on this device.
import { ArrowUpRight, Heart } from 'lucide-react';
import { useReveal } from '../components/shared';
import { Link } from '../router';
import { useCatalogue, useWishlist } from '../state';
import { ProductCard } from './RetailHome';

export default function WishlistPage() {
  const { status, products } = useCatalogue();
  const { slugs } = useWishlist();
  const saved = products.filter(p => slugs.includes(p.slug));
  useReveal([status, saved.length]);

  return (
    <main className="retail-landing shop-page section">
      <header className="shop-heading">
        <h1 className="page-title">Wishlist</h1>
        {saved.length > 0 && <p className="muted">{saved.length} saved on this device</p>}
      </header>
      {saved.length > 0 && (
        <div className="product-grid studio-grid">
          {saved.map(p => <ProductCard key={p.id} product={p} to={`/p/${p.slug}`} shopActions />)}
        </div>
      )}
      {status !== 'loading' && saved.length === 0 && (
        <div className="empty">
          <Heart />
          <h3>Nothing saved yet.</h3>
          <p>Tap the heart on any product to keep it here for later.</p>
          <Link className="button dark" to="/shop">Explore the collection <ArrowUpRight size={18} /></Link>
        </div>
      )}
    </main>
  );
}
