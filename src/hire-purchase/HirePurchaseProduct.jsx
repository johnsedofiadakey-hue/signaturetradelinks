// A product as seen in the hire-purchase store: no bag, no instalment figures; the path is apply, then buy once approved.
import { ArrowLeft, ArrowUpRight, ClipboardCheck } from 'lucide-react';
import { ProductImage } from '../components/shared';
import { NotFound, ProductDetails } from '../retail/ProductPage';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { useProduct } from '../useProduct';

export default function HirePurchaseProduct({ slug }) {
  const { loading, product, description, specifications, detailStatus } = useProduct(slug);
  if (loading) return <main className="section"><p className="muted">Loading…</p></main>;
  if (!product) return <NotFound backTo="/hire-purchase#eligible" backLabel="Back to hire purchase" />;

  if (!product.hirePurchase) {
    return (
      <main className="section narrow-page">
        <p className="eyebrow">HIRE PURCHASE</p>
        <h1 className="page-title">{product.name} isn’t available on hire purchase.</h1>
        <p className="muted">You can still buy it outright in the shop.</p>
        <div className="row-actions">
          <Link className="button dark" to={`/p/${product.slug}`}>View in the shop <ArrowUpRight size={18} /></Link>
          <Link className="button outline" to="/hire-purchase#eligible">See eligible products</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="pdp section">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/hire-purchase#eligible"><ArrowLeft size={14} /> Eligible products</Link></nav>
      <div className="pdp-grid">
        <div className="pdp-media">
          <ProductImage product={product} eager />
          {(product.illustrative || product.illustration) && <span className="media-label">{product.illustration ? 'Illustration' : 'Illustrative photo'}</span>}
        </div>
        <div className="pdp-buy">
          <p className="eyebrow">{product.category} · HIRE PURCHASE</p>
          <h1 className="page-title">{product.name}</h1>
          <dl className="hp-facts">
            <div><dt>Cash price</dt><dd>{formatPrice(product.price)}</dd></div>
            <div><dt>Deposit and instalments</dt><dd>Shown in your agreement once you are approved</dd></div>
          </dl>
          <div className="hp-panel">
            <ClipboardCheck size={22} />
            <div>
              <strong>For approved customers</strong>
              <p>Apply once. When our team approves you, sign in and buy this through your account, within your approved amount.</p>
            </div>
          </div>
          <Link className="button dark full" to={`/hire-purchase/apply?product=${encodeURIComponent(product.slug)}`}>Apply to get approved <ArrowUpRight size={18} /></Link>
          <p className="muted small">Prefer to pay in full? <Link className="inline-link" to={`/p/${product.slug}`}>Buy it outright in the shop</Link>.</p>
        </div>
      </div>
      <ProductDetails description={description} specifications={specifications} detailStatus={detailStatus} />
    </main>
  );
}
