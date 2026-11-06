// A product in the hire-purchase store. It has no cart, wishlist or retail actions: the next step is always within this store.
import { ArrowUpRight } from 'lucide-react';
import { ProductImage } from '../components/shared';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';

export default function HirePurchaseCard({ product, to, action = 'View details' }) {
  return (
    <article className="hp-card" data-reveal>
      <Link className="hp-card-image" to={to} aria-label={`${action}: ${product.name}`}>
        <ProductImage product={product} />
        {(product.illustrative || product.illustration) && <span className="media-label">{product.illustration ? 'Illustration' : 'Illustrative photo'}</span>}
      </Link>
      <div className="hp-card-body">
        <span className="hp-card-category">{product.category}</span>
        <h3><Link to={to}>{product.name}</Link></h3>
        <p>{product.price ? <>Cash price {formatPrice(product.price)}</> : formatPrice(product.price)}</p>
        <Link className="hp-card-action" to={to}>{action} <ArrowUpRight size={15} /></Link>
      </div>
    </article>
  );
}
