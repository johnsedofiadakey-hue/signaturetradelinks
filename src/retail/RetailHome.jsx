// The retail home page: categories lead into the shop (ShopPage). Hire purchase appears only as one quiet signpost.
import { useState } from 'react';
import { ArrowUpRight, Grid2X2, Headphones, Plus, ShoppingCart, Smartphone, Tv, WashingMachine, Wind } from 'lucide-react';
import HeroCarousel from '../components/HeroCarousel';
import ShoppingConfidence, { ProductFacts } from '../components/ShoppingConfidence';
import ShoppableRoom from '../components/ShoppableRoom';
import {CardDiscoveryActions,ProductFinderBanner,RecentlyViewed,useDiscovery} from '../discovery/DiscoveryProvider';
import AssessmentPath from '../components/AssessmentPath';
import { categoryPhotos, productMedia } from '../productMedia';
import { OfflineNote, ProductImage, useReveal, WishButton } from '../components/shared';
import { Link, navigate } from '../router';
import { formatPrice, loadProductDetail } from '../services/catalogue';
import { useBag, useCatalogue } from '../state';

const categoryIcons = { audio: Headphones, 'tv-and-entertainment': Tv, cooling: Wind, 'home-appliances': WashingMachine, 'phones-and-computing': Smartphone };
const ALL = { slug: 'all', label: 'All products' };
const HOME_PRODUCTS = 4;

const FAQ = [
  ['How do I pay?', 'You pay in full at checkout on Paystack’s secure page, by MTN MoMo, Telecel Cash, AT Money, Visa, Mastercard or bank transfer. The price you see is the price you pay, plus any delivery fee shown before you confirm.'],
  ['Can I collect in store?', 'Yes. At checkout you will choose delivery to your area or collection from our store. Delivery areas, fees and the store address will be confirmed before checkout opens.'],
  ['What if a product is out of stock?', 'It stays visible with an “Out of stock” label so you can check back. You can only check out with items we have in stock.'],
  ['Can I pay over time instead?', 'Hire purchase is a separate store for customers our team has assessed and approved. Visit the hire purchase store to see how it works.'],
];

/** One tap for a single-option product; anything with choices goes to its page, where the choice is made. */
function AddToCart({ product, to }) {
  const { add } = useBag();
  const [busy, setBusy] = useState(false);
  if (!product.price || product.availability === 'out_of_stock') return null;
  if (product.price.varies) return <Link className="card-add" to={to}>Choose options</Link>;

  async function addOne() {
    setBusy(true);
    try {
      const { variants } = await loadProductDetail(product.slug);
      if (variants.length === 1 && variants[0].availability !== 'out_of_stock') add(product, { sku: variants[0].sku, price: { ...variants[0].price, varies: false } });
      else navigate(to);
    } catch {
      navigate(to);
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" className="card-add" onClick={addOne} disabled={busy}><ShoppingCart size={15} /> {busy ? 'Adding…' : 'Add to cart'}</button>;
}

export function ProductCard({ product, to, shopActions = false }) {
  return (
    <article className={`product-card ${productMedia(product).studio ? 'studio-card' : ''}`} data-reveal data-category={product.categorySlug}>
      <Link className="product-image" to={to} aria-label={`View ${product.name}`}>
        {product.tag && <span className="product-tag">{product.tag}</span>}
        <ProductImage product={product} />
        <span className="product-open"><ArrowUpRight size={18} /></span>
        {(product.illustrative || product.illustration) && <span className="media-label">{productMedia(product).studio ? 'AI-retouched preview' : product.illustration ? 'Illustration' : 'Illustrative photo'}</span>}
      </Link>
      <div className="product-meta">
        <span>{product.category}</span>
        <h3><Link to={to}>{product.name}</Link></h3>
        <p className="price">{formatPrice(product.price)}{product.availability === 'out_of_stock' && <span className="stock-note">Out of stock</span>}</p>
        {!to.startsWith('/hire-purchase') && <ProductFacts product={product}/>}
        {shopActions && <AddToCart product={product} to={to} />}
        {!to.startsWith('/hire-purchase') && <CardDiscoveryActions product={product}/>}
      </div>
      {shopActions && <WishButton product={product} className="on-card" />}
    </article>
  );
}

export default function RetailHome() {
  const { status, categories, products } = useCatalogue();
  const {recent}=useDiscovery();
  useReveal([status,recent.join('|')]);

  return (
    <main className="retail-landing">
      <HeroCarousel />
      <section className="shop section">
        <div className="section-top" data-reveal>
          <div><p className="eyebrow">THE EVERYDAY, UPGRADED</p><h2>What’s your next upgrade?</h2></div>
          <span className="muted small">A considered collection for home and beyond.</span>
        </div>
        <div className="category-grid photo-categories" data-reveal>
          {[ALL, ...categories].map(({ slug, label }) => {
            const Icon = categoryIcons[slug] ?? Grid2X2;
            const photos = categoryPhotos[slug];
            return <Link key={slug} data-category={slug} to={slug === ALL.slug ? '/shop' : `/shop/${slug}`} className="category"><span className={`category-visual ${photos?.length>1 ? 'category-pair' : ''}`}>{photos ? photos.map((src,i)=><img src={src} alt="" loading="lazy" decoding="async" key={src} className={`category-photo photo-${i}`}/>) : <Icon size={26} strokeWidth={1.4}/>}</span><span className="category-name">{label}<ArrowUpRight size={12}/></span></Link>;
          })}
        </div>
        <ProductFinderBanner/>
        <div className="product-toolbar"><span className="collection-accent" aria-hidden="true"/>
          <p><strong>Explore the collection</strong><Link className="shop-all-link" to="/shop">Shop all{status !== 'loading' && ` ${products.length}`} <ArrowUpRight size={13}/></Link></p>
        </div>
        <OfflineNote />
        <div className="product-grid studio-grid">
          {products.slice(0, HOME_PRODUCTS).map(p => <ProductCard key={p.id} product={p} to={`/p/${p.slug}`} shopActions />)}
        </div>
      </section>

      <RecentlyViewed/>
      <ShoppableRoom/>

      <section className="hp-signpost signature-hp" data-reveal>
        <div className="hp-signpost-copy"><p className="eyebrow">ANOTHER WAY TO YOUR NEXT UPGRADE</p><h2>Your upgrade.<br/>Your way to pay.</h2><p>Apply for assessment, then explore eligible products in our dedicated hire-purchase store.</p><Link className="button outline" to="/hire-purchase">Explore hire purchase <ArrowUpRight size={18}/></Link><small>Subject to assessment and approval.</small></div>
        <AssessmentPath/>
      </section>

      <ShoppingConfidence/>

      <section className="faq-section section" data-reveal>
        <div><p className="eyebrow">A FEW THINGS TO KNOW</p><h2>Good questions.<br />Clear answers.</h2></div>
        <div className="faq-list">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}<Plus size={17} /></summary><p>{a}</p></details>)}
        </div>
      </section>
    </main>
  );
}
