// Retail product page: price, stock, variant and quantity, then the cart. Hire purchase is one quiet link at the end.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Minus, Plus, ShoppingCart } from 'lucide-react';
import { SecureLine } from '../components/PaymentMethods';
import { ProductImage, WishButton } from '../components/shared';
import { Link } from '../router';
import { formatPrice } from '../services/catalogue';
import { useBag } from '../state';
import { useProduct } from '../useProduct';
import {useTrackProduct,WhatsAppEnquiry} from '../discovery/DiscoveryProvider';

const variantLabel = variant => Object.values(variant.attributes ?? {}).join(' · ') || variant.sku;

export function ProductDetails({ description, specifications, detailStatus }) {
  return (
    <section className="pdp-details">
      {detailStatus === 'loading' && <p className="muted">Loading product details…</p>}
      {detailStatus === 'error' && <p className="muted">Product details are unavailable right now. Please try again shortly.</p>}
      {description && <p className="pdp-description">{description}</p>}
      {specifications.length > 0 && (
        <>
          <h2>Specifications</h2>
          <dl className="spec-list">{specifications.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>
        </>
      )}
    </section>
  );
}

export function NotFound({ backTo = '/shop', backLabel = 'Back to the shop' }) {
  return (
    <main className="section narrow-page">
      <p className="eyebrow">NOT FOUND</p>
      <h1 className="page-title">We couldn’t find that product.</h1>
      <p className="muted">It may have been renamed or is no longer available.</p>
      <Link className="button dark" to={backTo}>{backLabel} <ArrowUpRight size={18} /></Link>
    </main>
  );
}

export default function ProductPage({ slug }) {
  const { loading, product, description, specifications, variants, detailStatus } = useProduct(slug);
  useTrackProduct(product);
  const { add } = useBag();
  const [sku, setSku] = useState(null);
  const [quantity, setQuantity] = useState(1);
  useEffect(() => { setSku(null); setQuantity(1); }, [slug]);

  if (loading) return <main className="section"><p className="muted">Loading…</p></main>;
  if (!product) return <NotFound />;

  // With priced variants, the shopper picks one; without, the product-level summary price and availability apply.
  const variant = variants.find(v => v.sku === sku) ?? (variants.length === 1 ? variants[0] : null);
  const needsChoice = variants.length > 1 && !variant;
  const price = variant ? { ...variant.price, varies: false } : product.price;
  const outOfStock = variant ? variant.availability === 'out_of_stock' : product.availability === 'out_of_stock';
  // Only a priced SKU can be checked out. Until staff price this product, it can be viewed but not bought.
  const unpriced = detailStatus !== 'loading' && variants.length === 0;

  return (
    <main className="pdp section">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/shop"><ArrowLeft size={14} /> Shop</Link>
        <span>/</span>
        <Link to={`/shop/${product.categorySlug}`}>{product.category}</Link>
      </nav>
      <div className="pdp-grid">
        <div className="pdp-media">
          <ProductImage product={product} eager />
          {(product.illustrative || product.illustration) && <span className="media-label">{product.illustration ? 'Illustration' : 'Illustrative photo'}</span>}
        </div>
        <div className="pdp-buy">
          <p className="eyebrow">{product.category}{product.illustrative && ' · ILLUSTRATIVE PRODUCT'}</p>
          <h1 className="page-title">{product.name}</h1>
          {product.tag && <p className="muted">{product.tag}</p>}
          <p className="pdp-price">{formatPrice(price)}</p>
          <p className={`pdp-stock ${outOfStock ? 'out' : product.availability === 'in_stock' || variant ? '' : 'unconfirmed'}`}>
            {outOfStock ? 'Out of stock. Check back soon.' : product.availability === 'in_stock' ? 'In stock' : 'Availability to be confirmed'}
          </p>

          {variants.length > 1 && (
            <fieldset className="variant-picker">
              <legend>Choose an option</legend>
              {variants.map(v => (
                <button key={v.sku} type="button" className={v.sku === variant?.sku ? 'selected' : ''} aria-pressed={v.sku === variant?.sku} onClick={() => setSku(v.sku)} disabled={v.availability === 'out_of_stock'}>
                  {variantLabel(v)}<span>{formatPrice(v.price)}</span>
                </button>
              ))}
            </fieldset>
          )}

          <div className="pdp-actions">
            <div className="stepper" role="group" aria-label="Quantity">
              <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="One fewer"><Minus size={14} /></button>
              <span aria-live="polite">{quantity}</span>
              <button type="button" onClick={() => setQuantity(q => Math.min(10, q + 1))} aria-label="One more"><Plus size={14} /></button>
            </div>
            <button className="button dark grow" disabled={outOfStock || needsChoice || unpriced || detailStatus === 'loading'} onClick={() => add(product, { sku: variant?.sku ?? null, price, quantity })}>
              {unpriced ? 'Not on sale yet' : needsChoice ? 'Choose an option' : 'Add to cart'} <ShoppingCart size={18} />
            </button>
            <WishButton product={product} className="on-page" />
          </div>
          <p className="muted small">Pay in full at checkout. Delivery or in-store collection is chosen there.</p>
          <SecureLine />

          <WhatsAppEnquiry product={product}/>

          {product.hirePurchase && (
            <p className="hp-quiet">Also available on hire purchase for approved customers. <Link to={`/hire-purchase/p/${product.slug}`}>See hire purchase</Link></p>
          )}
        </div>
      </div>
      <ProductDetails description={description} specifications={specifications} detailStatus={detailStatus} />
    </main>
  );
}
